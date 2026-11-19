// Draws the three wall pages and writes them in the panel's format.
//
//   WALL_CALENDAR_ICS            Google Calendar "secret address in iCal format" (or WALL_CALENDAR_FILE for a local .ics)
//   WALL_PHOTOS_FOLDER_ID        Google Drive folder id with the wall photos (optional)
//   GOOGLE_SERVICE_ACCOUNT_JSON  key for a service account the folder is shared with (optional)
//   NOW                          pretend it's this moment, e.g. 2026-11-04T16:10:00-07:00 (for testing)
//   OUT                          where to write files (default ../out)
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { eventsByDay, fetchCalendar } from "./lib/calendar.mjs";
import { buildModel } from "./lib/model.mjs";
import { local, addDays } from "./lib/time.mjs";
import { quantizeUI, packForPanel, previewPNG, pngToRGB } from "./lib/eink.mjs";
import { todaysPhoto } from "./lib/photos.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const readJSON = async (p) => JSON.parse(await fs.readFile(p, "utf8"));

const WMO = { 0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "cloudy", 45: "fog", 48: "fog", 51: "drizzle", 53: "drizzle", 55: "drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 71: "light snow", 73: "snow", 75: "heavy snow", 80: "showers", 81: "showers", 82: "heavy showers", 95: "storms", 96: "storms", 99: "storms" };

async function getWeather(cfg, tz) {
  try {
    const { latitude, longitude, units } = cfg.weather;
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,weather_code&temperature_unit=${units}&timezone=${encodeURIComponent(tz)}&forecast_days=1`;
    const j = await (await fetch(u)).json();
    return { hi: Math.round(j.daily.temperature_2m_max[0]), lo: Math.round(j.daily.temperature_2m_min[0]), text: WMO[j.daily.weather_code[0]] || "" };
  } catch (e) {
    console.warn("Weather unavailable:", e.message);
    return null;
  }
}

async function main() {
  const config = await readJSON(path.join(root, "config.json"));
  const menu = await readJSON(path.join(root, "menu.json"));
  const tz = config.timezone;
  const now = process.env.NOW ? new Date(process.env.NOW) : new Date();
  const L = local(now, tz);
  const out = path.resolve(process.env.OUT || path.join(root, "out"));
  await fs.mkdir(out, { recursive: true });

  const ics = process.env.WALL_CALENDAR_FILE
    ? await fs.readFile(process.env.WALL_CALENDAR_FILE, "utf8")
    : process.env.WALL_CALENDAR_ICS ? await fetchCalendar(process.env.WALL_CALENDAR_ICS) : null;
  if (!ics) throw new Error("No calendar: set the WALL_CALENDAR_ICS secret to your Wall calendar's secret iCal address.");
  const events = eventsByDay(ics, { tz, fromKey: addDays(L.key, -7), toKey: addDays(L.key, 7 * config.weeksShown + 7), choreWords: config.choreWords });

  const weather = await getWeather(config, tz);
  const model = buildModel({ now, config, menu, events, weather });
  const dayNumber = Math.floor(Date.UTC(L.y, L.m - 1, L.d) / 86400000);
  const photo = await todaysPhoto({ dayNumber, localDir: process.env.WALL_PHOTOS_DIR || path.join(root, "photos"), height: config.photoHeight }).catch((e) => { console.warn("Photo unavailable:", e.message); return null; });

  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const template = pathToFileURL(path.join(here, "template.html")).href;
  const pages = ["home", "meals"];
  for (const name of pages) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1600 }, deviceScaleFactor: 1 });
    await page.addInitScript(({ m, p, ph, h }) => { window.MODEL = m; window.PAGE = p; window.PHOTO = ph; window.PHOTO_HEIGHT = h; }, { m: model, p: name, ph: photo, h: config.photoHeight });
    await page.goto(template, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: 1200, height: 1600 } });
    const idx = quantizeUI(await pngToRGB(png), 1200, 1600);
    await fs.writeFile(path.join(out, `${name}.bin`), packForPanel(idx, config.rotate));
    await fs.writeFile(path.join(out, `${name}.png`), await previewPNG(idx));
    await page.close();
  }
  await browser.close();

  const offset = -Math.round((new Date(now.toLocaleString("en-US", { timeZone: "UTC" })) - new Date(now.toLocaleString("en-US", { timeZone: tz }))) / 60000);
  await fs.writeFile(path.join(out, "manifest.json"), JSON.stringify({
    generated: now.toISOString(),
    generatedEpoch: Math.floor(now.getTime() / 1000),
    utcOffsetMinutes: offset,
    pages,
    quietHours: config.quietHours,
    mealsPageReturnsAfterMinutes: config.mealsPageReturnsAfterMinutes,
  }, null, 2));
  console.log(`Rendered ${pages.join(", ")} for ${L.key} ${String(L.h).padStart(2, "0")}:${String(L.min).padStart(2, "0")} (${tz}) -> ${out}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });

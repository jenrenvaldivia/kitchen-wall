// Picks today's photo from the "Wall photos" Google Drive folder (or the repo's photos/ folder),
// and dithers it to the panel's six inks.
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ditherPhoto, SCREEN_W, SCREEN_H } from "./eink.mjs";

const IMG = /\.(jpe?g|png|webp|heic|heif|tiff?)$/i;

async function fromDrive(folderId, credentialsJson) {
  const { google } = await import("googleapis");
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(credentialsJson),
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  const drive = google.drive({ version: "v3", auth });
  const files = [];
  let pageToken;
  do {
    const r = await drive.files.list({
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
      fields: "nextPageToken, files(id, name, thumbnailLink)", pageSize: 1000, pageToken,
      supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    files.push(...r.data.files);
    pageToken = r.data.nextPageToken;
  } while (pageToken);
  files.sort((a, b) => a.name.localeCompare(b.name));
  return {
    count: files.length,
    names: files.map((f) => f.name),
    async load(i) {
      const f = files[i];
      const r = await drive.files.get({ fileId: f.id, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
      const buf = Buffer.from(r.data);
      try { await sharp(buf).metadata(); return buf; } catch {
        // iPhone HEIC photos: ask Drive for a large JPEG preview instead.
        if (!f.thumbnailLink) throw new Error(`Can't read ${f.name}`);
        const token = (await auth.getAccessToken());
        const t = await fetch(f.thumbnailLink.replace(/=s\d+$/, "=s1600"), { headers: { Authorization: `Bearer ${token}` } });
        return Buffer.from(await t.arrayBuffer());
      }
    },
  };
}

async function fromFolder(dir) {
  let names = [];
  try { names = (await fs.readdir(dir)).filter((n) => IMG.test(n)).sort(); } catch { /* no folder */ }
  return { count: names.length, names, load: (i) => fs.readFile(path.join(dir, names[i])) };
}

/** Returns a PNG data URI already reduced to the six inks, or null when there are no photos. */
// A photo whose name starts with a month number ("11-thanksgiving.jpg", "03 spring.png") is shown all that month.
// When no photo is named for this month, the photos take turns, one per day.
function pickIndex(names, month, dayNumber) {
  const mm = String(month).padStart(2, "0");
  const forMonth = names.map((n, i) => [n, i]).filter(([n]) => new RegExp(`^${mm}([^0-9]|$)`).test(n));
  if (forMonth.length) return forMonth[dayNumber % forMonth.length][1];
  return dayNumber % names.length;
}

export async function todaysPhoto({ dayNumber, month, localDir, height = 800 }) {
  const src = process.env.WALL_PHOTOS_FOLDER_ID && process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    ? await fromDrive(process.env.WALL_PHOTOS_FOLDER_ID, process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
    : await fromFolder(localDir);
  if (!src.count) return null;
  const buf = await src.load(pickIndex(src.names, month, dayNumber));
  const W = SCREEN_W, H = height;
  const { data } = await sharp(buf).rotate().resize(W, H, { fit: "cover", position: "centre" })
    .modulate({ saturation: 1.1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const inked = ditherPhoto(data, W, H);
  const png = await sharp(inked, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
  return "data:image/png;base64," + png.toString("base64");
}

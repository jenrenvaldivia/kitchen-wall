// Decides what each page shows at a given moment. Pure function: same inputs, same screen.
import { local, addDays, weekdayOf, dayOfMonth, monthOf, hm, clock, DOW, DOW_FULL, MONTHS } from "./time.mjs";

const PICKUP = /trash|recycl|compost|yard waste/i;

// Shortens a calendar title for a small cell: drops anything in parentheses and any time
// already written into the name ("Mr. Nature at Bookmans (River) - 10-11am" -> "Mr. Nature at Bookmans").
const T = String.raw`\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p)?`;
export function tidyTitle(title) {
  const t = title
    .replace(/\s*\([^)]*\)/g, "")
    .replace(new RegExp(`\\s*[-–—,]?\\s*(?:@|at)?\\s*${T}\\s*(?:[-–]\\s*${T})?\\s*$`, "i"), (m) => (/\d/.test(m) && /(am|pm|a|p|@|at|-|–)/i.test(m) ? "" : m))
    .replace(new RegExp(`\\s+(?:@|at)\\s*${T}(?=\\s|$)`, "i"), "")
    .replace(/\s{2,}/g, " ").trim();
  return t || title;
}

export function buildModel({ now, config, menu, events, weather }) {
  const tz = config.timezone;
  const L = local(now, tz);
  const today = L.key, t = L.minutes;
  const tomorrow = addDays(today, 1);
  const readyBy = hm(config.dinner.readyBy), eatAt = hm(config.dinner.eatAt);
  const evening = t >= hm(config.eveningStartsAt);
  const choresUntil = hm(config.morningChoresUntil);

  const dayMenu = (key) => menu.days[weekdayOf(key)];
  const mToday = dayMenu(today), mTomorrow = dayMenu(tomorrow);
  const startAt = readyBy - mToday.dinner.leadMinutes;
  const evs = (key) => events[key] || [];
  const todayAll = evs(today);
  const timedToday = todayAll.filter((e) => !e.allDay);
  const choresToday = todayAll.filter((e) => e.allDay && e.chore);
  const allDayToday = todayAll.filter((e) => e.allDay && !e.chore);
  const tonightTask = mToday.tonight; // the thaw for tomorrow's food

  // ---- the one thing that matters next ----
  let head;
  const choreHeadline = (list) => list.map((e) => (PICKUP.test(e.title) ? e.title + " out" : e.title)).join(" and ");
  const nextEv = timedToday.find((e) => e.start > t && e.start < startAt);
  if (evening) {
    const tm = evs(tomorrow), tmChores = tm.filter((e) => e.allDay && e.chore), tmFirst = tm.find((e) => !e.allDay);
    if (tonightTask) head = { cap: "Before bed", big: "Thaw for tomorrow", sub: tonightTask, kind: "thaw" };
    else if (tmChores.length) head = { cap: "Tomorrow morning", big: choreHeadline(tmChores), sub: tmChores.some((e) => PICKUP.test(e.title)) ? "Pickup is early." : "" };
    else if (tmFirst) head = { cap: `Tomorrow · ${clock(tmFirst.start)}`, big: tmFirst.title, sub: "" };
    else head = { cap: "Tomorrow", big: "A quiet day", sub: "Nothing on the calendar." };
  } else if (t < choresUntil && choresToday.length) {
    head = { cap: "This morning", big: choreHeadline(choresToday), sub: choresToday.some((e) => PICKUP.test(e.title)) ? "Pickup is early." : "", kind: "chores" };
  } else if (nextEv) {
    head = { cap: `Next · ${clock(nextEv.start)}`, big: nextEv.title, sub: `Then start dinner at ${clock(startAt)}.`, ev: nextEv };
  } else if (t < startAt + 15) {
    head = { cap: `${t >= startAt ? "Now" : "Today"} · ${clock(startAt)}`, big: "Start dinner", sub: mToday.dinner.why + "." };
  } else if (t < eatAt) {
    head = { cap: `Ready ${clock(readyBy)}`, big: `Dinner at ${clock(eatAt)}`, sub: "" };
  } else if (tonightTask) {
    head = { cap: "Tonight", big: "Thaw for tomorrow", sub: tonightTask, kind: "thaw" };
  } else {
    const later = timedToday.find((e) => e.start > t);
    head = later ? { cap: `Next · ${clock(later.start)}`, big: later.title, sub: "", ev: later }
                 : { cap: "Tonight", big: "Nothing else today", sub: "" };
  }
  head.urgent = !evening && t >= startAt - 20 && t < startAt + 15 && head.big === "Start dinner";
  // short label for the home page's left column
  head.short = head.cap.includes("·") ? head.cap.split("·").pop().trim()
    : ({ "This morning": "Morning", "Before bed": "Tonight", "Tomorrow morning": "Tomorrow" })[head.cap] || head.cap;

  // ---- meals in the band ----
  const focus = evening ? mTomorrow : mToday;
  const meals = [];
  if (evening || t < hm(config.breakfastShownUntil)) meals.push({ label: evening ? "Tomorrow's breakfast" : "Breakfast", name: focus.breakfast.name });
  meals.push({ label: `${evening ? "Tomorrow's dinner" : "Dinner"} · ready ${clock(readyBy)}`, name: focus.dinner.name });

  // ---- right-hand column of the band ----
  let side;
  if (evening) {
    const tm = evs(tomorrow).map((e) => ({ when: e.allDay ? (e.chore ? "Morning" : "All day") : clock(e.start), title: e.title }));
    side = { sections: [{ cap: "Tomorrow", agenda: tm, empty: "Nothing on the calendar" }] };
  } else {
    const sections = [];
    const agenda = [
      ...allDayToday.map((e) => ({ when: "All day", title: e.title })),
      ...timedToday.map((e) => ({ when: clock(e.start), title: e.title, done: e.end <= t, now: head.ev === e })),
    ].filter((a) => !(head.ev && a.title === head.ev.title && a.now));
    if (agenda.length) sections.push({ cap: "Today", agenda });
    if (choresToday.length && head.kind !== "chores") sections.push({ cap: "This morning", checks: choresToday.map((e) => ({ text: e.title, done: t >= choresUntil })) });
    if (tonightTask && head.kind !== "thaw") sections.push({ cap: "Tonight", checks: [{ text: tonightTask }] });
    if (!sections.length) sections.push({ cap: "Today", agenda: [], empty: "Nothing on the calendar" });
    side = { sections };
  }

  // ---- home page rows under the photo ----
  const rows = [{ label: head.short, text: head.big, hot: true, note: head.sub && head.big !== "Thaw for tomorrow" ? head.sub : "" }];
  if (evening || t < hm(config.breakfastShownUntil)) rows.push({ label: evening ? "Breakfast" : "Breakfast", text: focus.breakfast.name });
  rows.push({ label: "Dinner", text: focus.dinner.name });
  if (!evening && tonightTask && head.kind !== "thaw") rows.push({ label: "Tonight", text: tonightTask, check: true });
  if (evening && head.kind === "thaw") rows[0].note = tonightTask;

  // ---- calendar grid: rolling weeks from this Sunday ----
  const start = addDays(today, -weekdayOf(today));
  const cells = [];
  for (let i = 0; i < config.weeksShown * 7; i++) {
    const k = addDays(start, i), list = evs(k);
    const cal = config.calendar || {};
    const week = Math.floor(i / 7);
    const roomy = cal.thisWeekTaller && week === 0;
    const perCell = roomy ? 5 : cal.oneLine ? 3 : 2;
    const items = list.map((e) => ({ title: cal.tidyNames ? tidyTitle(e.title) : e.title, time: e.allDay ? null : clock(e.start), allDay: e.allDay, chore: e.chore }));
    if (weekdayOf(k) === config.prepDayWeekday) items.push({ title: "Prep day", prep: true, allDay: true });
    cells.push({
      day: dayOfMonth(k) === 1 ? `${MONTHS[monthOf(k) - 1].slice(0, 3)} 1` : String(dayOfMonth(k)),
      newMonth: dayOfMonth(k) === 1 || i === 0 ? MONTHS[monthOf(k) - 1].slice(0, 3) : "",
      today: k === today, past: k < today,
      items: items.slice(0, items.length > perCell ? perCell - 1 : perCell), more: items.length > perCell ? items.length - (perCell - 1) : 0,
    });
  }

  // ---- meals page ----
  const mealsPage = {
    title: evening ? "Tomorrow's meals" : "Today's meals",
    dateLine: `${DOW_FULL[weekdayOf(evening ? tomorrow : today)]}, ${MONTHS[monthOf(evening ? tomorrow : today) - 1]} ${dayOfMonth(evening ? tomorrow : today)}`,
    times: `Start by <b>${clock(readyBy - focus.dinner.leadMinutes)}</b> · ready ${clock(readyBy)} · eat ${clock(eatAt)}`,
    breakfast: focus.breakfast, dinner: focus.dinner, childName: menu.childName,
    beforeBed: tonightTask,
  };

  // ---- photo strip ----
  const laterList = (evening ? evs(tomorrow) : todayAll)
    .filter((e) => e.title !== head.big && !head.big.startsWith(e.title))
    .filter((e) => evening || (e.allDay ? (e.chore ? t < choresUntil : true) : e.start > t))
    .slice(0, 3)
    .map((e) => ({ when: e.allDay ? (e.chore ? "Morning" : "All day") : clock(e.start), title: e.title }));

  return {
    header: { weekday: DOW_FULL[L.dow], date: `${MONTHS[L.m - 1]} ${L.d}` },
    weather,
    head, meals, side, cells, rows, calendar: config.calendar || {},
    header2: { weekday: DOW_FULL[evening ? weekdayOf(tomorrow) : L.dow], date: evening ? `${MONTHS[monthOf(tomorrow) - 1]} ${dayOfMonth(tomorrow)}` : `${MONTHS[L.m - 1]} ${L.d}`, tomorrow: evening },
    dows: DOW,
    mealsPage,
    photoBar: { later: laterList, laterCap: evening ? "Tomorrow" : "Later today", dinnerLabel: evening ? "Tomorrow's dinner" : `Dinner · ready ${clock(readyBy)}`, dinner: focus.dinner.name },
  };
}

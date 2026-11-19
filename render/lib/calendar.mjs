// Reads a Google Calendar "secret address in iCal format" and sorts its events into local days.
import IcalExpander from "ical-expander";
import { local, keyOf, addDays } from "./time.mjs";

// An event is hidden when its title contains any hideEvents entry as a whole word or phrase
// ("AME" hides "AME 324A-Engineering Materials" but not "Game night"). Not case-sensitive.
function hider(words = []) {
  const res = words.filter(Boolean).map((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`, "i"));
  return (title) => res.some((r) => r.test(title));
}

/**
 * Returns { "2026-11-04": [ {title, allDay, start, end, chore} ... ] } for the days in [fromKey, toKey].
 * start/end are minutes after local midnight (null for all-day events).
 */
export function eventsByDay(icsText, { tz, fromKey, toKey, choreWords, hideEvents }) {
  const hidden = hider(hideEvents);
  const expander = new IcalExpander({ ics: icsText, maxIterations: 2000 });
  // Pad the window by a day on each side so time-zone edges never drop an event.
  const after = new Date(addDays(fromKey, -1) + "T00:00:00Z");
  const before = new Date(addDays(toKey, 2) + "T00:00:00Z");
  const { events, occurrences } = expander.between(after, before);

  const items = [
    ...events.map((e) => ({ title: e.summary, startDate: e.startDate, endDate: e.endDate, status: e.component.getFirstPropertyValue("status") })),
    ...occurrences.map((o) => ({ title: o.item.summary, startDate: o.startDate, endDate: o.endDate, status: o.item.component.getFirstPropertyValue("status") })),
  ];

  const isChore = (t) => choreWords.some((w) => t.toLowerCase().includes(w));
  const out = {};
  const push = (key, ev) => {
    if (key < fromKey || key > toKey) return;
    (out[key] ||= []).push(ev);
  };

  for (const it of items) {
    if ((it.status || "").toUpperCase() === "CANCELLED") continue;
    const title = (it.title || "").trim();
    if (!title || hidden(title)) continue;
    if (it.startDate.isDate) {
      // All-day: the end date is exclusive. Spread multi-day events across each day.
      let k = keyOf(it.startDate.year, it.startDate.month, it.startDate.day);
      const endK = it.endDate ? keyOf(it.endDate.year, it.endDate.month, it.endDate.day) : addDays(k, 1);
      do { push(k, { title, allDay: true, start: null, end: null, chore: isChore(title) }); k = addDays(k, 1); } while (k < endK);
    } else {
      const s = local(it.startDate.toJSDate(), tz);
      const e = it.endDate ? local(it.endDate.toJSDate(), tz) : s;
      const end = e.key === s.key ? e.minutes : 24 * 60;
      push(s.key, { title, allDay: false, start: s.minutes, end, chore: false });
    }
  }
  for (const k of Object.keys(out)) {
    out[k].sort((a, b) => (a.allDay === b.allDay ? (a.start ?? 0) - (b.start ?? 0) : a.allDay ? -1 : 1));
  }
  return out;
}

export async function fetchCalendar(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Calendar feed returned ${res.status}. Check the WALL_CALENDAR_ICS secret.`);
  return res.text();
}

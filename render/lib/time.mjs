// Time helpers that work in the household's time zone, whatever zone the computer running this is in.

const fmtCache = new Map();
function parts(date, tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
    });
    fmtCache.set(tz, f);
  }
  const o = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(o.weekday);
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, min: +o.minute, dow };
}

/** Local calendar date key, e.g. "2026-11-04". */
export const keyOf = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Where a moment falls in the household's time zone. */
export function local(date, tz) {
  const p = parts(date, tz);
  return { ...p, key: keyOf(p.y, p.m, p.d), minutes: p.h * 60 + p.min };
}

/** Adds whole days to a date key (calendar arithmetic, no time zone involved). */
export function addDays(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return keyOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function weekdayOf(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function dayOfMonth(key) { return +key.split("-")[2]; }
export function monthOf(key) { return +key.split("-")[1]; }

/** "16:45" -> 1005 */
export const hm = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

/** 1005 -> "4:45p", 1020 -> "5p" */
export function clock(min) {
  let h = Math.floor(min / 60) % 24, m = min % 60;
  const ap = h >= 12 ? "p" : "a";
  h = h % 12 || 12;
  return h + (m ? ":" + String(m).padStart(2, "0") : "") + ap;
}

export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DOW_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

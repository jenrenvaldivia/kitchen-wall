// Converts a rendered picture into the panel's own format:
// 1200x1600 portrait, 4 bits per pixel, six raw ink codes (from Seeed's reTerminal E1004 example).
// The screen hangs tall, so pages are drawn at the panel's native 1200x1600.
import sharp from "sharp";

// Ink colors the screen is designed with, and the code the panel expects for each.
export const INKS = [
  { name: "white",  rgb: [255, 255, 255], code: 0x0 },
  { name: "green",  rgb: [29, 185, 84],   code: 0x2 },
  { name: "red",    rgb: [229, 57, 53],   code: 0x6 },
  { name: "yellow", rgb: [255, 216, 0],   code: 0xb },
  { name: "blue",   rgb: [0, 76, 255],    code: 0xd },
  { name: "black",  rgb: [0, 0, 0],       code: 0xf },
];
const WHITE = 0, BLACK = 5;
export const PANEL_W = 1200, PANEL_H = 1600, SCREEN_W = 1200, SCREEN_H = 1600;

function nearestInk(r, g, b) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < INKS.length; i++) {
    const [R, G, B] = INKS[i].rgb, dr = r - R, dg = g - G, db = b - B;
    const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/**
 * For drawn pages (text, lines, flat colors). Grey anti-aliasing at text edges goes to black or white
 * instead of drifting to green or blue, which keeps letters crisp.
 */
function inkForUI(r, g, b) {
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  if (chroma < 64) return 0.299 * r + 0.587 * g + 0.114 * b < 150 ? BLACK : WHITE;
  return nearestInk(r, g, b);
}

/** RGB buffer (w*h*3) -> ink index per pixel */
export function quantizeUI(rgb, w, h) {
  const out = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 3) out[p] = inkForUI(rgb[i], rgb[i + 1], rgb[i + 2]);
  return out;
}

/** Floyd–Steinberg dither for photos. Returns an RGB buffer that only uses the six inks. */
export function ditherPhoto(rgb, w, h) {
  const buf = new Float32Array(rgb.length);
  for (let i = 0; i < rgb.length; i++) buf[i] = rgb[i];
  const out = Buffer.alloc(rgb.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    // Clamp, or leftover error snowballs into solid blotches of one ink (e.g. green patches in dark hair).
    const cl = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
    const r = cl(buf[i]), g = cl(buf[i + 1]), b = cl(buf[i + 2]);
    const [R, G, B] = INKS[nearestInk(r, g, b)].rgb;
    out[i] = R; out[i + 1] = G; out[i + 2] = B;
    const er = r - R, eg = g - G, eb = b - B;
    const spread = (dx, dy, f) => {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || xx >= w || yy >= h) return;
      const j = (yy * w + xx) * 3;
      buf[j] += er * f; buf[j + 1] += eg * f; buf[j + 2] += eb * f;
    };
    spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
  }
  return out;
}

/** Ink indices (1200x1600) -> packed 4bpp panel bytes. rotate 180 flips it if the screen hangs the other way up. */
export function packForPanel(idx, rotate = 0) {
  const out = Buffer.alloc((PANEL_W * PANEL_H) / 2);
  const N = PANEL_W * PANEL_H;
  for (let py = 0; py < PANEL_H; py++) {
    for (let px = 0; px < PANEL_W; px += 2) {
      const pick = (qx) => {
        const i = py * PANEL_W + qx;
        return INKS[idx[rotate === 180 ? N - 1 - i : i]].code;
      };
      out[(py * PANEL_W + px) >> 1] = (pick(px) << 4) | pick(px + 1);
    }
  }
  return out;
}

/** A PNG of what the panel will show, for checking on a computer. */
export async function previewPNG(idx, w = SCREEN_W, h = SCREEN_H) {
  const rgb = Buffer.alloc(w * h * 3);
  for (let p = 0; p < w * h; p++) rgb.set(INKS[idx[p]].rgb, p * 3);
  return sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

export async function pngToRGB(png) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== SCREEN_W || info.height !== SCREEN_H) throw new Error(`Expected ${SCREEN_W}x${SCREEN_H}, got ${info.width}x${info.height}`);
  return data;
}

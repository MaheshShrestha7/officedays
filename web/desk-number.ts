/* Pure helpers for reading the desk number off a label photo (no DOM, so they are unit tested). */

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

/** The area above the QR where the desk number is printed, clamped to the frame. */
export function labelRegion(qr: Point[], frameW: number, frameH: number): Rect | null {
  if (qr.length < 3) return null;
  const xs = qr.map((p) => p.x), ys = qr.map((p) => p.y);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  const size = Math.max(right - left, bottom - top);
  const cx = (left + right) / 2;
  const x = Math.max(0, Math.floor(cx - 1.3 * size));
  const y = Math.max(0, Math.floor(top - 1.6 * size));
  const x2 = Math.min(frameW, Math.ceil(cx + 1.3 * size));
  const y2 = Math.min(frameH, Math.ceil(top));
  if (x2 - x < 20 || y2 - y < 20) return null;
  return { x, y, w: x2 - x, h: y2 - y };
}

/** Picks the desk number out of OCR text, preferring the NN.NNN shape the labels use. */
export function pickDeskNumber(text: string): string | null {
  const clean = text.replace(/[,·]/g, ".").replace(/\s+/g, " ");
  const exact = clean.match(/(?<![\d.])\d{2}\.\d{3}(?![\d.])/);
  if (exact) return exact[0];
  const loose = clean.match(/(?<![\d.])\d{1,3}\.\d{2,4}(?![\d.])/);
  return loose ? loose[0] : null;
}

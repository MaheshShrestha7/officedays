/* Reads the desk number (like 24.002) printed in the label header above the desk QR.
 * Runs entirely on the phone: Tesseract.js is only downloaded the first time an unnamed desk is scanned. */

import { labelRegion, pickDeskNumber, type Point, type Rect } from "./desk-number";

export type { Point };

/** A still of the camera frame at the moment the QR was read, plus where the QR sat in it. */
export interface LabelShot { frame: HTMLCanvasElement; qr: Point[] }

/** Copies the current video frame so it can be read after the scanner closes. */
export function captureLabel(video: HTMLVideoElement, qr: Point[]): LabelShot | null {
  if (!video.videoWidth || qr.length < 3) return null;
  const frame = document.createElement("canvas");
  frame.width = video.videoWidth;
  frame.height = video.videoHeight;
  frame.getContext("2d")!.drawImage(video, 0, 0);
  return { frame, qr };
}

function crop(src: HTMLCanvasElement, r: Rect): HTMLCanvasElement {
  // Small text reads badly, so scale the crop up to a comfortable width.
  const scale = Math.max(1, Math.min(3, 900 / r.w));
  const out = document.createElement("canvas");
  out.width = Math.round(r.w * scale);
  out.height = Math.round(r.h * scale);
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, out.width, out.height);
  return out;
}

/** Tries the area above the QR first, then the whole frame. Resolves to null when nothing looks like a desk number,
 * or when reading takes too long (a slow download shouldn't leave the name field waiting forever). */
export function readDeskNumber(shot: LabelShot, workerOptions?: Record<string, string>): Promise<string | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 30_000));
  return Promise.race([read(shot, workerOptions).catch(() => null), timeout]);
}

async function read(shot: LabelShot, workerOptions?: Record<string, string>): Promise<string | null> {
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng", undefined, workerOptions);
  try {
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789.",
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    });
    const region = labelRegion(shot.qr, shot.frame.width, shot.frame.height);
    const images = region ? [crop(shot.frame, region), shot.frame] : [shot.frame];
    for (const image of images) {
      const { data } = await worker.recognize(image);
      const found = pickDeskNumber(data.text);
      if (found) return found;
    }
    return null;
  } finally {
    worker.terminate();
  }
}

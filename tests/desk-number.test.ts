import { describe, expect, it } from "vitest";
import { labelRegion, pickDeskNumber } from "../web/desk-number";

describe("pickDeskNumber", () => {
  it("finds the desk number in OCR text", () => {
    expect(pickDeskNumber("24.002\n")).toBe("24.002");
    expect(pickDeskNumber("1 25.002 7\n3")).toBe("25.002");
  });
  it("prefers the NN.NNN shape over other numbers", () => {
    expect(pickDeskNumber("3.14 24.002")).toBe("24.002");
  });
  it("accepts a comma read in place of the dot", () => {
    expect(pickDeskNumber("24,002")).toBe("24.002");
  });
  it("falls back to a looser number, or nothing", () => {
    expect(pickDeskNumber("4.12")).toBe("4.12");
    expect(pickDeskNumber("2400 . 7")).toBeNull();
    expect(pickDeskNumber("")).toBeNull();
  });
});

describe("labelRegion", () => {
  const qr = [{ x: 500, y: 400 }, { x: 700, y: 400 }, { x: 700, y: 600 }, { x: 500, y: 600 }];
  it("covers the area above the QR", () => {
    expect(labelRegion(qr, 1280, 720)).toEqual({ x: 340, y: 80, w: 520, h: 320 });
  });
  it("clamps to the frame", () => {
    const r = labelRegion(qr.map((p) => ({ x: p.x - 450, y: p.y - 300 })), 1280, 720)!;
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });
  it("gives up when the QR is at the top edge", () => {
    expect(labelRegion(qr.map((p) => ({ x: p.x, y: p.y - 400 })), 1280, 720)).toBeNull();
  });
});

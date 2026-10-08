import { describe, expect, it } from "vitest";
import { checkDeskQr } from "../src/server/qr";

const rules = { host: "virtual.floorsen.se", path: "/scan-code", sitekey: "office1" };
const desk = "https://virtual.floorsen.se/scan-code?eui64=00155500000001ab&sitekey=office1";

describe("checkDeskQr", () => {
  it("accepts any desk on the office site", () => {
    expect(checkDeskQr(desk, rules)).toEqual({ ok: true, desk: "00155500000001ab" });
    const other = desk.replace("00155500000001ab", "00155500000002CD");
    expect(checkDeskQr(other, rules)).toEqual({ ok: true, desk: "00155500000002cd" });
  });

  it("accepts the URL: prefix some scanners report", () => {
    expect(checkDeskQr(`URL:${desk}`, rules).ok).toBe(true);
  });

  it("accepts any site key when none is configured", () => {
    expect(checkDeskQr(desk.replace("office1", "elsewhere"), { ...rules, sitekey: undefined }).ok).toBe(true);
  });

  it.each([
    ["plain text", "hello"],
    ["another site", "https://example.com/scan-code?eui64=00155500000001ab&sitekey=office1"],
    ["lookalike host", "https://virtual.floorsen.se.evil.com/scan-code?eui64=00155500000001ab&sitekey=office1"],
    ["http", desk.replace("https:", "http:")],
    ["wrong path", desk.replace("/scan-code", "/other")],
    ["missing desk id", "https://virtual.floorsen.se/scan-code?sitekey=office1"],
    ["short desk id", desk.replace("00155500000001ab", "01ab")],
    ["other office", desk.replace("office1", "office2")],
    ["no site key", "https://virtual.floorsen.se/scan-code?eui64=00155500000001ab"],
  ])("rejects %s", (_, qr) => {
    expect(checkDeskQr(qr, rules).ok).toBe(false);
  });
});

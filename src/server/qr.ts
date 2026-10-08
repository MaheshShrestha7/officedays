export interface QrRules {
  host: string;
  path: string;
  /** When set, the QR's sitekey must match exactly. */
  sitekey?: string;
}

export type QrResult =
  | { ok: true; desk: string }
  | { ok: false; reason: string };

/**
 * Checks that a decoded QR payload has the office desk "skeleton":
 * https://<host><path>?eui64=<16 hex>&sitekey=<key>. Only the desk id varies per desk.
 */
export function checkDeskQr(raw: string, rules: QrRules): QrResult {
  const text = raw.trim().replace(/^url:/i, "");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "This QR code is not an office desk code." };
  }
  if (url.protocol !== "https:" || url.hostname !== rules.host.toLowerCase() || url.pathname !== rules.path) {
    return { ok: false, reason: "This QR code is not an office desk code." };
  }
  const desk = url.searchParams.get("eui64") ?? "";
  if (!/^[0-9a-f]{16}$/i.test(desk)) {
    return { ok: false, reason: "This desk code is missing its desk id." };
  }
  const sitekey = url.searchParams.get("sitekey") ?? "";
  if (!sitekey || (rules.sitekey && sitekey !== rules.sitekey)) {
    return { ok: false, reason: "This desk code belongs to a different office." };
  }
  return { ok: true, desk: desk.toLowerCase() };
}

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface VapidKeys {
  publicKey: string; // base64url, uncompressed P-256 point
  privateKey: string; // base64url, 32-byte scalar
}

/**
 * The app's VAPID key pair for web push. Created on first use and kept in D1, so no
 * secret has to be set up by hand. The scheduled reminder job reads the same row.
 */
export async function getVapidKeys(db: D1Database): Promise<VapidKeys> {
  const row = await db.prepare("SELECT value FROM app_config WHERE key = 'vapid'").first<{ value: string }>();
  if (row) return JSON.parse(row.value);

  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  const keys: VapidKeys = { publicKey: b64url(raw), privateKey: jwk.d! };
  // Another request may have won the race; whatever is stored is the answer.
  await db.prepare("INSERT OR IGNORE INTO app_config (key, value) VALUES ('vapid', ?)").bind(JSON.stringify(keys)).run();
  const stored = await db.prepare("SELECT value FROM app_config WHERE key = 'vapid'").first<{ value: string }>();
  return JSON.parse(stored!.value);
}

/**
 * Client side of DPoP (RFC 9449).
 *
 * The signing key is a non-extractable ES256 key pair kept in IndexedDB. Script (and therefore XSS) can use it
 * to sign while the page is open, but can never read the private key out, so tokens stolen from the page are useless elsewhere.
 */

const DB_NAME = "si-security";
const STORE = "keys";
const KEY_ID = "dpop";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

let keyPairPromise: Promise<CryptoKeyPair> | undefined;

/** Loads the persisted key pair, or generates and stores a new one. */
export function getDpopKeyPair(): Promise<CryptoKeyPair> {
  return (keyPairPromise ??= (async () => {
    const stored = await idb<CryptoKeyPair | undefined>("readonly", s => s.get(KEY_ID));
    if (stored) return stored;

    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
    await idb("readwrite", s => s.put(pair, KEY_ID));
    return pair;
  })());
}

/** Forget the key (e.g. on logout), so the next login is bound to a fresh key. */
export async function resetDpopKey(): Promise<void> {
  keyPairPromise = undefined;
  await idb("readwrite", s => s.delete(KEY_ID));
}

const b64url = (data: ArrayBuffer | Uint8Array): string => {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlJson = (o: unknown): string => b64url(new TextEncoder().encode(JSON.stringify(o)));

/**
 * Creates a DPoP proof for `method url`.
 * @param url Full request URL; query and fragment are dropped, the rest must match the server's PUBLIC_URL + path.
 * @param accessToken Pass it on requests that carry an access token, so the proof is bound to it (`ath`).
 */
export async function createDpopProof(method: string, url: string, accessToken?: string): Promise<string> {
  const { privateKey, publicKey } = await getDpopKeyPair();
  const { kty, crv, x, y } = await crypto.subtle.exportKey("jwk", publicKey); // public members only

  const u = new URL(url);
  const header = { typ: "dpop+jwt", alg: "ES256", jwk: { kty, crv, x, y } };
  const payload: Record<string, unknown> = {
    htm: method.toUpperCase(),
    htu: u.origin + u.pathname,
    jti: crypto.randomUUID(),
    iat: Math.floor(Date.now() / 1000),
  };
  if (accessToken) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(accessToken));
    payload.ath = b64url(hash);
  }

  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  // WebCrypto's ECDSA output is the raw r||s form that JWS ES256 requires (no DER conversion needed).
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64url(sig)}`;
}

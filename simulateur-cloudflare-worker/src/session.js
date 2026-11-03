/* ============================================================
   Sessions — remplacement des sessions Flask (cookie signé
   HMAC-SHA256 via Web Crypto, disponible dans les Workers).
   Payload : { role, sid, logged_at }
   ============================================================ */

const COOKIE_NAME = "session";
const MAX_AGE = 30 * 24 * 3600;   // 30 jours (garde l'historique "Mes simulations")

const enc = new TextEncoder();
const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

let _keyPromise = null;
async function getKey(secret) {
  if (!_keyPromise) {
    _keyPromise = crypto.subtle.importKey(
      "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  }
  return _keyPromise;
}

async function sign(payloadStr, secret) {
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payloadStr));
  return b64url(sig);
}

/* Crée la valeur du cookie de session */
export async function createSessionValue(data, secret) {
  const payload = b64url(enc.encode(JSON.stringify(data)));
  const sig = await sign(payload, secret);
  return payload + "." + sig;
}

/* En-tête Set-Cookie pour poser la session */
export async function sessionCookie(data, secret) {
  const v = await createSessionValue(data, secret);
  return `${COOKIE_NAME}=${v}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${MAX_AGE}`;
}

/* En-tête Set-Cookie pour effacer la session */
export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

/* Lit et vérifie la session depuis l'en-tête Cookie */
export async function readSession(request, secret) {
  const cookie = request.headers.get("Cookie") || "";
  const m = new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`).exec(cookie);
  if (!m) return null;
  const [payload, sig] = m[1].split(".");
  if (!payload || !sig) return null;
  try {
    const expected = await sign(payload, secret);
    // comparaison à temps constant approximée (longueurs égales attendues)
    if (expected.length !== sig.length) return null;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    }
    if (diff !== 0) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    if (data && (data.role === "user" || data.role === "admin")) return data;
    return null;
  } catch (e) {
    return null;
  }
}

/* current_user() équivalent Flask : {role, sid} ou null */
export async function currentUser(request, secret) {
  const s = await readSession(request, secret);
  if (!s) return null;
  return { role: s.role, sid: s.sid || "" };
}

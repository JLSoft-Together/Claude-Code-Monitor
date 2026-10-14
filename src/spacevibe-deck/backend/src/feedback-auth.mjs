import { PayloadError } from "./payload.mjs";

const GOOGLE_KEYS = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const TOKEN_MAX_BYTES = 8192;
const FETCH_TIMEOUT_MS = 5000;
const MAX_KEY_CACHE_MS = 60 * 60_000;
let cachedKeys = null;

function decode(part) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new PayloadError(401);
  try {
    return Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
      c.charCodeAt(0),
    );
  } catch {
    throw new PayloadError(401);
  }
}

function decodeJson(part) {
  try {
    return JSON.parse(new TextDecoder().decode(decode(part)));
  } catch {
    throw new PayloadError(401);
  }
}

async function signingKey(kid, now) {
  // A fixed trusted endpoint: never follow token-supplied jku/x5u URLs.
  if (!cachedKeys || cachedKeys.expires <= now) {
    const response = await fetch(GOOGLE_KEYS, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error("Google keys unavailable");
    const body = await response.json();
    if (!Array.isArray(body.keys)) throw new Error("Invalid Google key response");
    const maxAge = Number(response.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1] ?? 0);
    cachedKeys = { keys: body.keys, expires: now + Math.min(maxAge * 1000, MAX_KEY_CACHE_MS) };
  }
  const key = cachedKeys.keys.find(
    (item) => item.kid === kid && item.kty === "RSA" && item.alg === "RS256" && item.use === "sig",
  );
  if (!key) throw new PayloadError(401);
  return crypto.subtle.importKey(
    "jwk",
    key,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

/** GIS callback credentials are bearer tokens kept only in the page's memory. */
export async function authenticateFeedback(request, env, now = Date.now()) {
  if (!env.GOOGLE_CLIENT_ID) throw new Error("Google sign-in is not configured");
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || authorization.length > TOKEN_MAX_BYTES)
    throw new PayloadError(401);
  const parts = authorization.slice(7).split(".");
  if (parts.length !== 3) throw new PayloadError(401);
  const header = decodeJson(parts[0]);
  const claims = decodeJson(parts[1]);
  if (header?.alg !== "RS256" || typeof header.kid !== "string" || header.crit)
    throw new PayloadError(401);
  const key = await signingKey(header.kid, now);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decode(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid || !validClaims(claims, env.GOOGLE_CLIENT_ID, now)) throw new PayloadError(401);
  return { sub: claims.sub, email: claims.email };
}

function validClaims(c, audience, now) {
  return (
    c &&
    ISSUERS.includes(c.iss) &&
    c.aud === audience &&
    (!c.azp || c.azp === audience) &&
    Number.isFinite(c.exp) &&
    c.exp * 1000 > now &&
    Number.isFinite(c.iat) &&
    c.iat * 1000 <= now + 60_000 &&
    (c.nbf === undefined || (Number.isFinite(c.nbf) && c.nbf * 1000 <= now)) &&
    typeof c.sub === "string" &&
    c.sub.length > 0 &&
    c.sub.length <= 255 &&
    c.email_verified === true &&
    typeof c.email === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email) &&
    c.email.length <= 254 &&
    // Google is authoritative for Gmail and verified Workspace email only.
    (c.email.toLowerCase().endsWith("@gmail.com") || (typeof c.hd === "string" && c.hd.length > 0))
  );
}

import { createFeedbackRepository } from "./feedback-repository.mjs";
import { PayloadError, UUID_V4 } from "./payload.mjs";

export const FEEDBACK_WEBHOOK_PATH = "/v1/feedback/linear-webhook";
const BODY_LIMIT = 128 * 1024;
const MAX_AGE_MS = 60_000;
const HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

async function readSignedEvent(request, secret) {
  const signature = request.headers.get("linear-signature") ?? "";
  if (!/^[a-f0-9]{64}$/i.test(signature)) throw new PayloadError(401);
  if (!request.body) throw new PayloadError(400);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_LIMIT) {
        await reader.cancel();
        throw new PayloadError(413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const raw = new Uint8Array(await new Blob(chunks).arrayBuffer());
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const bytes = Uint8Array.from(signature.match(/../g), (hex) => parseInt(hex, 16));
  if (!(await crypto.subtle.verify("HMAC", key, bytes, raw))) throw new PayloadError(401);
  let event;
  try {
    event = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new PayloadError(400);
  }
  if (
    !event ||
    !Number.isSafeInteger(event.webhookTimestamp) ||
    Math.abs(Date.now() - event.webhookTimestamp) > MAX_AGE_MS
  ) {
    throw new PayloadError(401);
  }
  return event;
}

export async function handleFeedbackWebhook(request, env) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: HEADERS });
  try {
    if (!env.LINEAR_WEBHOOK_SECRET) throw new Error("Webhook not configured");
    const event = await readSignedEvent(request, env.LINEAR_WEBHOOK_SECRET);
    if (event.type === "Issue" && ["create", "update", "remove"].includes(event.action)) {
      if (!UUID_V4.test(event.data?.id ?? "")) throw new PayloadError(400);
      const repository = createFeedbackRepository(env.DB);
      // Ignore all issues except ids created by this feedback repository.
      const row = await repository.findById(event.data.id);
      if (row && event.action === "remove") await repository.remove(row.id);
      else if (row) {
        const reachedProgress =
          event.data.stateId === env.FEEDBACK_PROGRESS_STATE_ID &&
          event.data.teamId === env.FEEDBACK_TEAM_ID &&
          !event.data.archivedAt &&
          Array.isArray(event.data.labelIds) &&
          event.data.labelIds.includes(env.FEEDBACK_LABEL_ID);
        await repository.requestSync(row.id, reachedProgress);
      }
    }
    // Persist the refresh request before acknowledgment. No network round trip
    // here: Linear requires an acknowledgment within five seconds.
    return new Response(null, { status: 200, headers: HEADERS });
  } catch (error) {
    return new Response(null, {
      status: error instanceof PayloadError ? error.status : 503,
      headers: HEADERS,
    });
  }
}

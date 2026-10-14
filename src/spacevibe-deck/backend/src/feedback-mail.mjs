const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;
// Resend only remembers idempotency keys for 24h. Stop ambiguous retries
// before that expires; a maintainer reconciles delivery before retrying.
const SAFE_RETRY_WINDOW_MS = 23 * 60 * 60_000;
const BOARD_URL = "https://deck.spacevibe.dev/feedback";

export async function deliverFeedbackMail(env, repository, now = Date.now()) {
  const pending = await repository.pendingMail(now);
  let failed = 0;
  for (const event of pending) {
    try {
      if (!env.RESEND_API_KEY || !env.FEEDBACK_EMAIL_FROM) throw new Error("Email not configured");
      if (event.first_attempt_at !== null && now - event.first_attempt_at >= SAFE_RETRY_WINDOW_MS) {
        await repository.mailNeedsReview(event.id);
        failed += 1;
        continue;
      }
      const attempt = await repository.startMail(event.id, now);
      if (!attempt) continue;
      await sendMail(env, attempt);
      await repository.mailSent(event.id, now);
    } catch {
      // The durable row remains pending; report only a count, never PII.
      failed += 1;
    }
  }
  return failed;
}

async function sendMail(env, event) {
  const progress = event.kind === "progress";
  const message = progress
    ? "Work has started on your feedback."
    : "Your feedback has been approved and is now public.";
  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": event.id,
    },
    body: JSON.stringify({
      from: env.FEEDBACK_EMAIL_FROM,
      to: [event.recipient],
      subject: progress ? "Your Deck feedback is in progress" : "Your Deck feedback is approved",
      text: `${message}\n\n${event.title}\n\nView the feedback board: ${BOARD_URL}\n\nYou received this update because you submitted feedback to SpaceVibe Deck.`,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Email provider unavailable");
  const body = await response.json();
  if (typeof body.id !== "string" || !body.id) throw new Error("Email receipt missing");
}

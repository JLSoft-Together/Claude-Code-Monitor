import { createFeedbackIssue, readFeedbackState } from "./linear-feedback.mjs";
import { createFeedbackRepository } from "./feedback-repository.mjs";
import { deliverFeedbackMail } from "./feedback-mail.mjs";

export const FEEDBACK_SYNC_CRON = "* * * * *";

export async function syncFeedback(env, now = Date.now()) {
  // Separate from intake: closing new submissions must not stop moderation or mail.
  if (env.FEEDBACK_SYNC_ENABLED !== "true") return;
  const repository = createFeedbackRepository(env.DB);
  const lease = await repository.acquireLease(now);
  if (!lease) return;
  let failed = 0;
  try {
    const rows = await repository.pendingSync();
    for (const row of rows) {
      // Rotate failures to the back as well, so a broken issue cannot starve others.
      await repository.checked(row.id, now);
      try {
        if (!row.linear_synced) {
          await createFeedbackIssue(env, row);
          await repository.synced(row.id);
        }
        await repository.applyModeration(row.id, await readFeedbackState(env, row.id), now);
      } catch {
        failed += 1;
      }
    }
    failed += await deliverFeedbackMail(env, repository, now);
  } finally {
    await repository.releaseLease(lease);
  }
  if (failed) throw new Error(`Feedback background jobs failed: ${failed}`);
}

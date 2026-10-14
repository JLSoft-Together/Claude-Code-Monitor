import { PayloadError, UUID_V4 } from "./payload.mjs";

export const PAGE_SIZE = 30;
export const SYNC_BATCH_SIZE = 5;
export const PUBLIC_STATUSES = ["pending", "review", "done"];
const LEASE_MS = 5 * 60_000;

export function parseBoardCursor(value) {
  if (!value) return null;
  const [time, id, extra] = value.split(":");
  if (extra !== undefined || !/^\d{1,16}$/.test(time) || !UUID_V4.test(id)) {
    throw new PayloadError(400);
  }
  const createdAt = Number(time);
  if (!Number.isSafeInteger(createdAt)) throw new PayloadError(400);
  return { createdAt, id };
}

function publicItem(row) {
  return {
    id: row.id,
    identifier: row.linear_identifier,
    title: row.title,
    description: row.body,
    category: row.category,
    status: row.status,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/** SQL and identity never escape this boundary through a public projection. */
export function createFeedbackRepository(db) {
  const statement = (sql, ...args) => db.prepare(sql).bind(...args);
  const findById = (id) => statement("SELECT * FROM feedback WHERE id = ?", id).first();

  async function create(input, user, now = Date.now()) {
    // The public/Linear id is server-generated; a visitor cannot collide with
    // another user's id or an existing unrelated issue in the owner's workspace.
    await statement(
      `INSERT INTO feedback (id, draft_id, google_sub, email, title, body, category, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(google_sub, draft_id) DO NOTHING`,
      crypto.randomUUID(),
      input.id,
      user.sub,
      user.email,
      input.title,
      input.body,
      input.category,
      now,
      now,
    ).run();
    const row = await statement(
      "SELECT * FROM feedback WHERE google_sub = ? AND draft_id = ?",
      user.sub,
      input.id,
    ).first();
    if (!row) throw new Error("Feedback persistence failed");
    if (row.title !== input.title || row.body !== input.body || row.category !== input.category) {
      throw new PayloadError(409);
    }
    return row.id;
  }

  async function listPublic(cursor) {
    const rows = await statement(
      `SELECT id, linear_identifier, title, body, category, status, updated_at, created_at
       FROM feedback WHERE status IN ('pending', 'review', 'done') AND deleted_at IS NULL
       AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?))
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      PAGE_SIZE + 1,
    ).all();
    const page = rows.results.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    return {
      items: page.map(publicItem),
      nextCursor: rows.results.length > PAGE_SIZE ? `${last.created_at}:${last.id}` : null,
    };
  }

  async function applyModeration(id, state, now = Date.now()) {
    // D1 batch is transactional. Only the latest authoritative Linear snapshot
    // can change visibility; milestone rows and visibility commit together.
    const update = statement(
      `UPDATE feedback SET status = ?, source_updated_at = ?, updated_at = ?,
       linear_identifier = ?, linear_synced = 1
       WHERE id = ? AND source_updated_at < ? AND deleted_at IS NULL`,
      state.status,
      state.version,
      now,
      state.identifier,
      id,
      state.version,
    );
    const milestone = (kind, enabled) =>
      statement(
        `INSERT INTO feedback_mail (id, feedback_id, kind, recipient, title, created_at)
       SELECT id || ':' || ?, id, ?, email, title, ? FROM feedback
       WHERE id = ? AND source_updated_at = ? AND deleted_at IS NULL
       AND status IN ('pending', 'review', 'done') AND ? = 1
       ON CONFLICT(feedback_id, kind) DO NOTHING`,
        kind,
        kind,
        now,
        id,
        state.version,
        enabled ? 1 : 0,
      );
    await db.batch([
      update,
      milestone("approved", PUBLIC_STATUSES.includes(state.status)),
      milestone("progress", state.inProgress),
    ]);
  }

  return {
    create,
    findById,
    listPublic,
    applyModeration,
    async remove(id, now = Date.now()) {
      await statement(
        "UPDATE feedback SET status = 'hidden', deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
        now,
        now,
        id,
      ).run();
    },
    async pendingSync() {
      const { results } = await statement(
        `SELECT * FROM feedback WHERE deleted_at IS NULL
         ORDER BY checked_at, linear_synced, created_at LIMIT ?`,
        SYNC_BATCH_SIZE,
      ).all();
      return results;
    },
    async checked(id, now) {
      await statement("UPDATE feedback SET checked_at = ? WHERE id = ?", now, id).run();
    },
    async synced(id) {
      await statement("UPDATE feedback SET linear_synced = 1 WHERE id = ?", id).run();
    },
    async requestSync(id, reachedProgress = false, now = Date.now()) {
      // Preserve intermediate In Progress events even if the next poll already
      // observes Done. Visibility still comes from the latest Linear snapshot.
      const milestone = (kind) =>
        statement(
          `INSERT INTO feedback_mail (id, feedback_id, kind, recipient, title, created_at)
         SELECT id || ':' || ?, id, ?, email, title, ? FROM feedback
         WHERE id = ? AND deleted_at IS NULL AND ? = 1
         ON CONFLICT(feedback_id, kind) DO NOTHING`,
          kind,
          kind,
          now,
          id,
          reachedProgress ? 1 : 0,
        );
      await db.batch([
        statement("UPDATE feedback SET checked_at = 0 WHERE id = ?", id),
        milestone("approved"),
        milestone("progress"),
      ]);
    },
    async acquireLease(now) {
      const token = crypto.randomUUID();
      const row = await statement(
        `UPDATE feedback_jobs SET lease_token = ?, lease_until = ?
         WHERE name = 'sync' AND lease_until < ? RETURNING lease_token`,
        token,
        now + LEASE_MS,
        now,
      ).first();
      return row?.lease_token ?? null;
    },
    async releaseLease(token) {
      await statement(
        "UPDATE feedback_jobs SET lease_until = 0 WHERE name = 'sync' AND lease_token = ?",
        token,
      ).run();
    },
    async pendingMail(now) {
      const { results } = await statement(
        `SELECT m.* FROM feedback_mail m JOIN feedback f ON f.id = m.feedback_id
         WHERE m.sent_at IS NULL AND m.needs_review = 0 AND m.next_attempt_at <= ?
         AND f.deleted_at IS NULL AND f.status IN ('pending', 'review', 'done')
         ORDER BY m.created_at, m.kind LIMIT ?`,
        now,
        SYNC_BATCH_SIZE,
      ).all();
      return results;
    },
    async startMail(id, now) {
      return statement(
        `UPDATE feedback_mail SET first_attempt_at = COALESCE(first_attempt_at, ?), next_attempt_at = ?
         WHERE id = ? AND sent_at IS NULL AND EXISTS (
           SELECT 1 FROM feedback f WHERE f.id = feedback_mail.feedback_id
           AND f.deleted_at IS NULL AND f.status IN ('pending', 'review', 'done')
         ) RETURNING *`,
        now,
        now + 60_000,
        id,
      ).first();
    },
    async mailSent(id, now) {
      await statement("UPDATE feedback_mail SET sent_at = ? WHERE id = ?", now, id).run();
    },
    async mailNeedsReview(id) {
      await statement("UPDATE feedback_mail SET needs_review = 1 WHERE id = ?", id).run();
    },
  };
}

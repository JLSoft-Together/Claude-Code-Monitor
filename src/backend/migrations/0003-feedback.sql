-- Feedback has owner-controlled retention, independent of usage_days cleanup.
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  google_sub TEXT NOT NULL,
  email TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('bug', 'idea', 'other')),
  status TEXT NOT NULL DEFAULT 'private' CHECK (status IN ('private', 'pending', 'review', 'done', 'hidden')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  linear_identifier TEXT,
  linear_synced INTEGER NOT NULL DEFAULT 0,
  source_updated_at INTEGER NOT NULL DEFAULT 0,
  checked_at INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  UNIQUE (google_sub, draft_id)
);
CREATE INDEX feedback_public ON feedback(status, created_at DESC, id DESC);
CREATE INDEX feedback_sync ON feedback(linear_synced, checked_at);

CREATE TABLE feedback_mail (
  id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('approved', 'progress')),
  recipient TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  first_attempt_at INTEGER,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER,
  needs_review INTEGER NOT NULL DEFAULT 0,
  UNIQUE (feedback_id, kind)
);
CREATE INDEX feedback_mail_pending ON feedback_mail(sent_at, needs_review, next_attempt_at);

CREATE TABLE feedback_jobs (
  name TEXT PRIMARY KEY,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);
INSERT INTO feedback_jobs(name) VALUES ('sync');

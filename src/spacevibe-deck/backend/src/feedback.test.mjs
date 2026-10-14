import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createFeedbackRepository, parseBoardCursor, PAGE_SIZE } from "./feedback-repository.mjs";
import { syncFeedback } from "./feedback-sync.mjs";
import { createFeedbackIssue, describeFeedback, probeFeedbackConfig } from "./linear-feedback.mjs";
import { authenticateFeedback } from "./feedback-auth.mjs";
import worker from "./worker.mjs";

const ORIGIN = "https://deck.spacevibe.dev";
const API = "https://api.deck.spacevibe.dev/v1/feedback";
const user = { sub: "google-subject", email: "reporter@gmail.com" };
const input = {
  id: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  title: "Split pane focus",
  body: "Steps\nDetails",
  category: "bug",
  website: "",
};
const keys = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
);
const jwk = {
  ...(await crypto.subtle.exportKey("jwk", keys.publicKey)),
  kid: "test-key",
  alg: "RS256",
  use: "sig",
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function database(t) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../migrations/0003-feedback.sql", import.meta.url), "utf8"));
  t.after(() => sqlite.close());
  const prepare = (sql) => ({
    bind: (...args) => ({
      run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...args).changes } }),
      first: async () => sqlite.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    }),
  });
  const binding = {
    prepare,
    batch: async (statements) => {
      sqlite.exec("BEGIN");
      try {
        const result = await Promise.all(statements.map((s) => s.run()));
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { sqlite, binding, repository: createFeedbackRepository(binding) };
}

function env(db, overrides = {}) {
  return {
    DB: db,
    GOOGLE_CLIENT_ID: "test.apps.googleusercontent.com",
    LINEAR_API_KEY: "test-linear",
    LINEAR_WEBHOOK_SECRET: "test-webhook-signing-secret",
    RESEND_API_KEY: "test-mail",
    FEEDBACK_EMAIL_FROM: "Deck <feedback@example.com>",
    FEEDBACK_TEAM_ID: "team",
    FEEDBACK_LABEL_ID: "label",
    FEEDBACK_BACKLOG_STATE_ID: "backlog",
    FEEDBACK_PROGRESS_STATE_ID: "progress",
    FEEDBACK_SUBMISSIONS_OPEN: "true",
    FEEDBACK_SYNC_ENABLED: "true",
    FEEDBACK_LIMITER: { limit: async () => ({ success: true }) },
    ...overrides,
  };
}

async function token(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString(
    "base64url",
  );
  const claims = Buffer.from(
    JSON.stringify({
      iss: "https://accounts.google.com",
      aud: "test.apps.googleusercontent.com",
      sub: user.sub,
      email: user.email,
      email_verified: true,
      iat: now,
      exp: now + 3600,
      ...overrides,
    }),
  ).toString("base64url");
  const signed = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keys.privateKey,
    new TextEncoder().encode(signed),
  );
  return `${signed}.${Buffer.from(signature).toString("base64url")}`;
}

function submit(body, credential, origin = ORIGIN) {
  return new Request(API, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${credential}`, origin },
    body: JSON.stringify(body),
  });
}

function providers(t, respond = () => json({}, 503)) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url === "https://www.googleapis.com/oauth2/v3/certs") return json({ keys: [jwk] });
    const call = { url, init, body: JSON.parse(init.body) };
    calls.push(call);
    return respond(call);
  });
  return calls;
}

const state = (status = "pending", version = 100, inProgress = false) => ({
  status,
  version,
  inProgress,
  identifier: "DECK-999",
});

test("POST acknowledges only persisted private feedback and does not call Linear", async (t) => {
  const { binding, sqlite } = database(t);
  const calls = providers(t);
  const response = await worker.fetch(submit(input, await token()), env(binding));
  assert.equal(response.status, 201);
  const receipt = await response.json();
  assert.equal(receipt.status, "private");
  const row = sqlite.prepare("SELECT * FROM feedback").get();
  assert.equal(row.id, receipt.id);
  assert.notEqual(row.id, input.id);
  assert.equal(row.email, user.email);
  assert.equal(row.status, "private");
  assert.equal(calls.length, 0);
  assert.deepEqual((await (await worker.fetch(new Request(API), env(binding))).json()).items, []);
});

test("D1 rejection returns 503 and never reports success", async (t) => {
  providers(t);
  const db = {
    prepare() {
      throw new Error("storage down");
    },
  };
  assert.equal((await worker.fetch(submit(input, await token()), env(db))).status, 503);
});

test("authentication checks signature, audience, issuer, expiry and verified Google email", async (t) => {
  providers(t);
  assert.deepEqual(await authenticateFeedback(submit(input, await token()), env()), user);
  for (const claims of [
    { aud: "other" },
    { iss: "evil" },
    { exp: 1 },
    { email_verified: false },
    { sub: "" },
    { email: "user@third-party.example" },
    { iat: 9999999999 },
  ]) {
    await assert.rejects(authenticateFeedback(submit(input, await token(claims)), env()), {
      status: 401,
    });
  }
  const valid = await token();
  const [header, body, signature] = valid.split(".");
  const tampered = `${header}.${Buffer.from(JSON.stringify({ sub: "attacker" })).toString("base64url")}.${signature}`;
  await assert.rejects(authenticateFeedback(submit(input, tampered), env()), { status: 401 });
  for (const bad of ["", "abc", `${header}.${body}.!`, `e30.${body}.${signature}`]) {
    await assert.rejects(authenticateFeedback(submit(input, bad), env()), { status: 401 });
  }
});

test("invalid input, honeypot and foreign origins never save; closed intake leaves public reads", async (t) => {
  const { binding, sqlite, repository } = database(t);
  providers(t);
  const credential = await token();
  for (const value of [
    { ...input, id: "" },
    { ...input, title: "x" },
    { ...input, body: "x".repeat(2001) },
    { ...input, email: "spoof@gmail.com" },
    { ...input, category: "bad" },
    { ...input, website: "spam" },
  ]) {
    assert.equal((await worker.fetch(submit(value, credential), env(binding))).status, 400);
  }
  assert.equal(
    (await worker.fetch(submit(input, credential, "https://evil.example"), env(binding))).status,
    403,
  );
  assert.equal((await worker.fetch(submit(input, ""), env(binding))).status, 401);
  assert.equal(
    (
      await worker.fetch(
        submit(input, credential),
        env(binding, { FEEDBACK_LIMITER: { limit: async () => ({ success: false }) } }),
      )
    ).status,
    429,
  );
  assert.equal(sqlite.prepare("SELECT count(*) n FROM feedback").get().n, 0);
  const id = await repository.create(input, user);
  await repository.applyModeration(id, state());
  const closed = env(binding, { FEEDBACK_SUBMISSIONS_OPEN: "false" });
  assert.equal((await worker.fetch(submit(input, credential), closed)).status, 503);
  const page = await (await worker.fetch(new Request(API), closed)).json();
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].description, input.body);
  assert.doesNotMatch(JSON.stringify(page), /google-subject|reporter@gmail|draft_id/);
});

test("retries are immutable and scoped to Google subject, not user-supplied public ids", async (t) => {
  const { repository, sqlite } = database(t);
  const id = await repository.create(input, user);
  assert.equal(await repository.create(input, user), id);
  await assert.rejects(repository.create({ ...input, body: "Changed" }, user), { status: 409 });
  assert.notEqual(await repository.create(input, { ...user, sub: "another-user" }), id);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM feedback").get().n, 2);
});

test("public pagination reaches old Done items with equal timestamps and no private rows", async (t) => {
  const { repository } = database(t);
  for (let index = 0; index < PAGE_SIZE + 4; index++) {
    const id = await repository.create({ ...input, id: crypto.randomUUID() }, user, 1);
    await repository.applyModeration(id, state("done"));
  }
  await repository.create({ ...input, id: crypto.randomUUID() }, user);
  const first = await repository.listPublic(null);
  const last = await repository.listPublic(parseBoardCursor(first.nextCursor));
  assert.equal(first.items.length, PAGE_SIZE);
  assert.equal(last.items.length, 4);
  assert.equal(last.nextCursor, null);
  assert.equal(new Set([...first.items, ...last.items].map((x) => x.id)).size, PAGE_SIZE + 4);
  assert.throws(() => parseBoardCursor("0:bad"), { status: 400 });
});

test("moderation is monotonic, milestones are atomic and duplicates cannot send again", async (t) => {
  const { repository, sqlite } = database(t);
  const id = await repository.create(input, user);
  await repository.applyModeration(id, state("pending", 100));
  await repository.applyModeration(id, state("review", 200, true));
  await repository.applyModeration(id, state("review", 200, true));
  await repository.applyModeration(id, state("hidden", 150));
  assert.equal((await repository.findById(id)).status, "review");
  assert.equal(sqlite.prepare("SELECT count(*) n FROM feedback_mail").get().n, 2);
  await repository.applyModeration(id, state("hidden", 300));
  assert.equal((await repository.listPublic(null)).items.length, 0);
  assert.equal((await repository.pendingMail(Date.now())).length, 0);
  await repository.remove(id);
  await repository.applyModeration(id, state("pending", 400));
  assert.equal((await repository.findById(id)).status, "hidden");
});

test("failure creating a milestone rolls back publication", async (t) => {
  const { repository, sqlite } = database(t);
  const id = await repository.create(input, user);
  sqlite.exec(
    "CREATE TRIGGER fail_mail BEFORE INSERT ON feedback_mail BEGIN SELECT RAISE(ABORT, 'mail unavailable'); END;",
  );
  await assert.rejects(repository.applyModeration(id, state()));
  assert.equal((await repository.findById(id)).status, "private");
});

function linearSnapshot(id, type = "unstarted", version = 100) {
  return {
    data: {
      issues: {
        nodes: [
          {
            id,
            identifier: "DECK-999",
            updatedAt: new Date(version).toISOString(),
            archivedAt: null,
            team: { id: "team" },
            state: { type, id: type === "started" ? "progress" : "todo" },
            labels: { nodes: [{ id: "label" }] },
          },
        ],
      },
    },
  };
}

test("Linear outage keeps durable intake; retry creates one linked issue and sends milestones once", async (t) => {
  const { repository, binding, sqlite } = database(t);
  const id = await repository.create(input, user);
  providers(t);
  await assert.rejects(syncFeedback(env(binding)), /background jobs failed/);
  assert.equal((await repository.findById(id)).linear_synced, 0);
  t.mock.restoreAll();
  const calls = providers(t, ({ url, body }) =>
    url.includes("resend")
      ? json({ id: "email-receipt" })
      : body.query.includes("issueCreate")
        ? json({ data: { issueCreate: { success: true } } })
        : json(linearSnapshot(id)),
  );
  await syncFeedback(env(binding));
  await syncFeedback(env(binding));
  assert.equal((await repository.findById(id)).status, "pending");
  assert.equal(calls.filter((c) => c.body.query?.includes("issueCreate")).length, 1);
  const mail = calls.filter((c) => c.url.includes("resend"));
  assert.equal(mail.length, 1);
  assert.deepEqual(mail[0].body.to, [user.email]);
  assert.equal(mail[0].init.headers["idempotency-key"], `${id}:approved`);
  assert.equal(sqlite.prepare("SELECT sent_at FROM feedback_mail").get().sent_at > 0, true);
});

test("mail retries keep their key and stop before the provider's deduplication window expires", async (t) => {
  const { repository, binding, sqlite } = database(t);
  const id = await repository.create(input, user);
  await repository.synced(id);
  await repository.applyModeration(id, state());
  const started = Date.now();
  const calls = providers(t, ({ url }) =>
    url.includes("resend") ? json({}, 503) : json(linearSnapshot(id)),
  );
  await assert.rejects(syncFeedback(env(binding), started));
  await assert.rejects(syncFeedback(env(binding), started + 60_000));
  await assert.rejects(syncFeedback(env(binding), started + 24 * 60 * 60_000));
  const mail = calls.filter((c) => c.url.includes("resend"));
  assert.equal(mail.length, 2);
  assert.equal(mail[0].init.headers["idempotency-key"], mail[1].init.headers["idempotency-key"]);
  assert.equal(sqlite.prepare("SELECT needs_review FROM feedback_mail").get().needs_review, 1);
});

test("concurrent scheduled jobs share a lease", async (t) => {
  const { repository, binding } = database(t);
  await repository.create(input, user);
  const lease = await repository.acquireLease(Date.now());
  const calls = providers(t);
  await syncFeedback(env(binding));
  assert.equal(calls.length, 0);
  await repository.releaseLease("wrong-token");
  assert.equal(await repository.acquireLease(Date.now()), null);
  await repository.releaseLease(lease);
  assert.ok(await repository.acquireLease(Date.now()));
});

async function webhook(event, secret = "test-webhook-signing-secret") {
  const raw = JSON.stringify({
    type: "Issue",
    action: "update",
    webhookTimestamp: Date.now(),
    ...event,
  });
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  return new Request(`${API}/linear-webhook`, {
    method: "POST",
    headers: { "linear-signature": Buffer.from(signature).toString("hex") },
    body: raw,
  });
}

test("signed webhooks persist refresh/delete, reject stale/forged events and ignore unrelated ids", async (t) => {
  const { repository, binding } = database(t);
  const id = await repository.create(input, user);
  await repository.applyModeration(id, state());
  await repository.checked(id, 100);
  const calls = providers(t);
  assert.equal((await worker.fetch(await webhook({ data: { id } }), env(binding))).status, 200);
  assert.equal((await repository.findById(id)).checked_at, 0);
  assert.equal(
    (await worker.fetch(await webhook({ data: { id }, action: "remove" }, "wrong"), env(binding)))
      .status,
    401,
  );
  assert.equal(
    (await worker.fetch(await webhook({ data: { id }, webhookTimestamp: 1 }), env(binding))).status,
    401,
  );
  assert.equal(
    (await worker.fetch(await webhook({ data: { id: crypto.randomUUID() } }), env(binding))).status,
    200,
  );
  assert.equal(
    (await worker.fetch(await webhook({ data: { id }, action: "remove" }), env(binding))).status,
    200,
  );
  assert.equal((await repository.listPublic(null)).items.length, 0);
  assert.equal(calls.length, 0);
});

test("Linear issue creation fences text, assigns type and recovers a lost response", async (t) => {
  const description = describeFeedback({ body: "```` https://linear.app/a", category: "other" });
  assert.match(description, /`````text/);
  assert.match(description, /linear\[\.\]app/);
  const calls = providers(t, ({ body }) =>
    body.query.includes("issueCreate")
      ? json({}, 503)
      : json({ data: { issue: { id: input.id } } }),
  );
  await createFeedbackIssue(env(), input);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.variables.input.id, input.id);
  assert.equal(calls[0].body.variables.input.stateId, "backlog");
});

test("configuration stays closed when dependencies are missing and preflight allows bearer auth", async (t) => {
  const { binding } = database(t);
  const response = await worker.fetch(
    new Request(`${API}/config`),
    env(binding, { RESEND_API_KEY: undefined }),
  );
  assert.equal((await response.json()).submissionsOpen, false);
  const preflight = await worker.fetch(
    new Request(API, { method: "OPTIONS", headers: { origin: ORIGIN } }),
    env(binding),
  );
  assert.equal(preflight.headers.get("access-control-allow-origin"), ORIGIN);
  assert.match(preflight.headers.get("access-control-allow-headers"), /authorization/);
});

test("probe rejects missing or archived Linear configuration", async (t) => {
  providers(t, () =>
    json({
      data: { viewer: { id: "user" }, team: { id: "team" }, feedback: { archivedAt: "date" } },
    }),
  );
  await assert.rejects(probeFeedbackConfig(env()));
});

test("a signed In Progress event followed by Done before polling still delivers both milestones", async (t) => {
  const { repository, binding, sqlite } = database(t);
  const id = await repository.create(input, user);
  await repository.synced(id);
  const data = { id, stateId: "progress", teamId: "team", labelIds: ["label"], archivedAt: null };
  assert.equal((await worker.fetch(await webhook({ data }), env(binding))).status, 200);
  assert.equal((await worker.fetch(await webhook({ data }), env(binding))).status, 200);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM feedback_mail").get().n, 2);
  assert.equal((await repository.listPublic(null)).items.length, 0);
  const calls = providers(t, ({ url }) =>
    url.includes("resend") ? json({ id: "receipt" }) : json(linearSnapshot(id, "completed", 300)),
  );
  await syncFeedback(env(binding));
  assert.equal((await repository.findById(id)).status, "done");
  assert.equal(calls.filter((c) => c.url.includes("resend")).length, 2);
});

test("actual Linear state mappings preserve moderation and never hide a missing snapshot", async (t) => {
  const { repository, binding, sqlite } = database(t);
  const id = await repository.create(input, user);
  await repository.synced(id);
  const variants = [
    ["backlog", {}, false],
    ["unstarted", {}, true],
    ["started", {}, true],
    ["completed", {}, true],
    ["canceled", {}, false],
    ["unstarted", { archivedAt: new Date(900).toISOString() }, false],
    [
      "completed",
      { archivedAt: new Date(900).toISOString(), autoArchivedAt: new Date(900).toISOString() },
      true,
    ],
    ["unstarted", { labels: { nodes: [] } }, false],
    ["unstarted", { team: { id: "other" } }, false],
  ];
  for (const [index, [type, changes, visible]] of variants.entries()) {
    t.mock.restoreAll();
    const snapshot = linearSnapshot(id, type, (index + 1) * 1000);
    const changed = {
      data: { issues: { nodes: [{ ...snapshot.data.issues.nodes[0], ...changes }] } },
    };
    providers(t, ({ url }) => (url.includes("resend") ? json({ id: "receipt" }) : json(changed)));
    await syncFeedback(env(binding));
    assert.equal(
      (await repository.listPublic(null)).items.length,
      visible ? 1 : 0,
      type + JSON.stringify(changes),
    );
  }
  assert.equal(sqlite.prepare("SELECT count(*) n FROM feedback_mail").get().n, 2);
  await repository.applyModeration(id, state("pending", 10000));
  t.mock.restoreAll();
  providers(t, () => json({ data: { issues: { nodes: [] } } }));
  await assert.rejects(syncFeedback(env(binding)));
  assert.equal((await repository.listPublic(null)).items.length, 1);
});

test("lost mail receipt and failed sent_at write retry the identical payload without early delivery", async (t) => {
  const { repository, binding, sqlite } = database(t);
  const id = await repository.create(input, user);
  await repository.synced(id);
  await repository.applyModeration(id, state());
  const now = Date.now();
  let requests = 0;
  const calls = providers(t, ({ url }) => {
    if (!url.includes("resend")) return json(linearSnapshot(id));
    requests++;
    if (requests === 1) throw new Error("receipt lost after provider accepted");
    return json({ id: "same-receipt" });
  });
  await assert.rejects(syncFeedback(env(binding), now));
  await syncFeedback(env(binding), now + 30_000);
  assert.equal(requests, 1);
  sqlite.exec(
    "CREATE TRIGGER fail_sent BEFORE UPDATE OF sent_at ON feedback_mail BEGIN SELECT RAISE(ABORT, 'write failed'); END;",
  );
  await assert.rejects(syncFeedback(env(binding), now + 60_000));
  sqlite.exec("DROP TRIGGER fail_sent;");
  await syncFeedback(env(binding), now + 120_000);
  await syncFeedback(env(binding), now + 180_000);
  const mail = calls.filter((c) => c.url.includes("resend"));
  assert.equal(mail.length, 3);
  assert.deepEqual(
    mail.map((c) => c.body),
    [mail[0].body, mail[0].body, mail[0].body],
  );
  assert.equal(new Set(mail.map((c) => c.init.headers["idempotency-key"])).size, 1);
});

test("webhook write failures do not acknowledge removal or refresh", async (t) => {
  const { repository, binding, sqlite } = database(t);
  const id = await repository.create(input, user);
  await repository.applyModeration(id, state());
  sqlite.exec(
    "CREATE TRIGGER fail_refresh BEFORE UPDATE ON feedback BEGIN SELECT RAISE(ABORT, 'write failed'); END;",
  );
  for (const action of ["update", "remove"]) {
    assert.equal(
      (await worker.fetch(await webhook({ action, data: { id } }), env(binding))).status,
      503,
    );
  }
  assert.equal((await repository.listPublic(null)).items.length, 1);
  sqlite.exec("DROP TRIGGER fail_refresh;");
  assert.equal(
    (await worker.fetch(await webhook({ action: "remove", data: { id } }), env(binding))).status,
    200,
  );
  assert.equal((await repository.listPublic(null)).items.length, 0);
});

test("body limits allow full CJK details and reject oversized streams", async (t) => {
  const { binding } = database(t);
  providers(t);
  const credential = await token();
  assert.equal(
    (await worker.fetch(submit({ ...input, body: "漢".repeat(2000) }, credential), env(binding)))
      .status,
    201,
  );
  assert.equal(
    (await worker.fetch(submit({ ...input, website: "x".repeat(17000) }, credential), env(binding)))
      .status,
    413,
  );
});

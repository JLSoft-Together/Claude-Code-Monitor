/**
 * Linear is the moderation surface. D1 owns the original feedback and retries
 * delivery here; the owner controls publication by moving the linked issue.
 */
const LINEAR_ENDPOINT = "https://api.linear.app/graphql";
// A hung Linear call must not hang the visitor; the landing keeps the draft.
const LINEAR_TIMEOUT_MS = 10_000;

/**
 * Hourly config probe. It has its own cron so a broken feedback setup shows up
 * as a failed invocation that is never confused with usage retention.
 */
export const FEEDBACK_PROBE_CRON = "17 * * * *";

/** Workspace labels in SpaceVibe-Deck. */
const BUG_LABEL = "ed9079dd-f534-4092-98ec-241335972834";
const FEATURE_LABEL = "404554e5-9175-474e-b211-1a31ebde49e2";
// "Other" carries no Type; the owner picks one while triaging.
const NEEDS_DECISION_LABEL = "0968e82c-0db3-48ce-83c5-fe4afd04a5b3";
const LABEL_BY_CATEGORY = { bug: BUG_LABEL, idea: FEATURE_LABEL, other: NEEDS_DECISION_LABEL };
const CATEGORY_NAME = { bug: "Bug", idea: "Idea", other: "Other" };

const CREATE_ISSUE = `mutation CreateFeedback($input: IssueCreateInput!) {
  issueCreate(input: $input) { success }
}`;
const FIND_ISSUE = `query FindFeedback($id: String!) {
  issue(id: $id) { id }
}`;
const FEEDBACK_STATE = `query FeedbackState($id: ID!, $label: ID!) {
  issues(first: 1, includeArchived: true, filter: { id: { eq: $id } }) {
    nodes {
      id identifier updatedAt archivedAt autoArchivedAt team { id } state { id type }
      labels(first: 1, filter: { id: { eq: $label } }) { nodes { id } }
    }
  }
}`;

const PROBE = `query FeedbackProbe(
  $team: String!, $label: String!, $state: String!,
  $bug: String!, $feature: String!, $decision: String!
) {
  viewer { id }
  team(id: $team) { id }
  feedback: issueLabel(id: $label) { archivedAt }
  bug: issueLabel(id: $bug) { archivedAt }
  feature: issueLabel(id: $feature) { archivedAt }
  decision: issueLabel(id: $decision) { archivedAt }
  backlog: workflowState(id: $state) { archivedAt }
}`;

/** Any failure throws; callers answer 503 and never log the error, which can echo input. */
async function linear(env, query, variables) {
  if (!env.LINEAR_API_KEY) throw new Error("LINEAR_API_KEY is not configured");
  // Personal API keys go in the header bare, without a Bearer prefix.
  const response = await fetch(LINEAR_ENDPOINT, {
    method: "POST",
    headers: { authorization: env.LINEAR_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(LINEAR_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Linear answered ${response.status}`);
  const result = await response.json();
  if (result.errors?.length || !result.data) throw new Error("Linear returned errors");
  return result.data;
}

/**
 * Fence the visitor's text so Linear shows it verbatim: no link, image or
 * heading renders from it. The fence outgrows any backtick run inside.
 */
function fence(text) {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), ([run]) => run.length));
  const marks = "`".repeat(Math.max(3, longest + 1));
  // A pasted linear.app URL turns into a live mention, which notifies people.
  return `${marks}text\n${text.replace(/linear\.app/gi, "linear[.]app")}\n${marks}`;
}

export function describeFeedback({ body, category }) {
  return [
    "## User report",
    "",
    body ? fence(body) : "No details were given.",
    "",
    "## Submission",
    "",
    `- Category: ${CATEGORY_NAME[category]}`,
    "- Source: deck.spacevibe.dev/feedback",
  ].join("\n");
}

async function issueExists(env, id) {
  try {
    const data = await linear(env, FIND_ISSUE, { id });
    return data.issue?.id === id;
  } catch {
    return false;
  }
}

export async function createFeedbackIssue(env, feedback) {
  const input = {
    teamId: env.FEEDBACK_TEAM_ID,
    title: feedback.title,
    description: describeFeedback(feedback),
    labelIds: [env.FEEDBACK_LABEL_ID, LABEL_BY_CATEGORY[feedback.category]],
    stateId: env.FEEDBACK_BACKLOG_STATE_ID,
    // The landing's per-draft UUID: a retry names the same issue, not a new one.
    ...(feedback.id ? { id: feedback.id } : {}),
  };
  try {
    const data = await linear(env, CREATE_ISSUE, { input });
    if (data.issueCreate?.success !== true) throw new Error("Linear refused the issue");
  } catch (error) {
    // The answer to an earlier try was lost but the issue landed: that is success.
    if (feedback.id && (await issueExists(env, feedback.id))) return;
    throw error;
  }
}

/** Only D1-owned issue ids are passed here; the public board never queries Linear. */
export async function readFeedbackState(env, id) {
  const data = await linear(env, FEEDBACK_STATE, { id, label: env.FEEDBACK_LABEL_ID });
  const issue = data.issues?.nodes?.[0];
  // Missing/inaccessible is not proof of owner deletion. Signed remove events
  // handle deletion; an API outage must never silently remove public feedback.
  if (!issue || issue.id !== id || !issue.state || !Array.isArray(issue.labels?.nodes)) {
    throw new Error("Feedback issue is unavailable");
  }
  const version = Math.max(Date.parse(issue.updatedAt), Date.parse(issue.archivedAt) || 0);
  if (!Number.isFinite(version) || typeof issue.identifier !== "string") {
    throw new Error("Invalid feedback state");
  }
  // Automatic Linear archiving must not age old approved feedback off the board.
  const manuallyArchived = issue.archivedAt && !issue.autoArchivedAt;
  const visible =
    issue.team?.id === env.FEEDBACK_TEAM_ID &&
    !manuallyArchived &&
    issue.labels.nodes.some((label) => label.id === env.FEEDBACK_LABEL_ID);
  const status = visible
    ? ({ unstarted: "pending", started: "review", completed: "done" }[issue.state.type] ?? "hidden")
    : "hidden";
  return {
    status,
    version,
    identifier: issue.identifier,
    inProgress: visible && issue.state.id === env.FEEDBACK_PROGRESS_STATE_ID,
  };
}

/**
 * Reject unless the key works and the team, labels and Backlog state it writes
 * to still exist unarchived. Names only — nothing a visitor typed.
 */
export async function probeFeedbackConfig(env) {
  const data = await linear(env, PROBE, {
    team: env.FEEDBACK_TEAM_ID,
    label: env.FEEDBACK_LABEL_ID,
    state: env.FEEDBACK_BACKLOG_STATE_ID,
    bug: BUG_LABEL,
    feature: FEATURE_LABEL,
    decision: NEEDS_DECISION_LABEL,
  });
  const broken = ["viewer", "team", "feedback", "bug", "feature", "decision", "backlog"].filter(
    (name) => !data[name] || data[name].archivedAt,
  );
  if (broken.length > 0) throw new Error(`Feedback config is broken: ${broken.join(", ")}`);
}

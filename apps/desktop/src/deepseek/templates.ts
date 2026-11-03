// Generic on purpose: these land in every user's ~/.codewhale, ~/.claude and ~/.codex, so no owner-specific rules.

/** Bump when any text below changes: every install's sync then reads as stale and the page offers it again. */
export const TEMPLATES_VERSION = 2

export const MANAGED_MARK = 'orrery-managed: "true"'

export const BLOCK_BEGIN = '<!-- orrery:begin -->'
export const BLOCK_END = '<!-- orrery:end -->'

export const WORKFLOW_BLOCK = `## Working inside Orrery

You are a DeepSeek (Codewhale) session inside Orrery, usually opened by a Claude Code or Codex pane to take a side
task: secondary code, writing or generating tests, or running the clone-app-re skill (\`/skill clone-app-re\`).

- Stay inside the files the task allows. Ask before touching anything else.
- Run the test command the task gives you and fix what fails.
- Never \`git commit\` or \`git push\`.
- When finished, follow the \`orrery-handoff\` skill: write the report
  \`.planning/handoff/DS-<yyyymmdd-hhmm>-<slug>.md\` (Task, Done, Files changed, Tests run + result,
  Open issues / next steps), then call the Orrery MCP tool \`hand_back\` with \`{ report, summary }\`.
  Orrery submits it into the pane that sent the task. Then stop.
- If \`hand_back\` fails, tell the user and give them the report path.`

export const CLAUDE_RULES_HEADING = `## Rules carried over from Claude Code (~/.claude/CLAUDE.md)

Claude Code skill names mentioned below are activated in Codewhale with \`/skill <name>\`.`

export const HANDOFF_SKILL = `---
name: orrery-handoff
description: Finish a task another agent (Claude Code or Codex) delegated to you through Orrery - write the hand-off report and call hand_back. Use when the task is done, blocked, or the user asks you to hand back.
metadata:
  ${MANAGED_MARK}
---

# Hand back to the agent that sent the task

1. Check the work against the task's done criteria. Run the test command from the task (or the project's usual
   one) and keep the exact result line.
2. Write the report to \`.planning/handoff/DS-<yyyymmdd-hhmm>-<slug>.md\` in the project root (create the folder):

   \`\`\`markdown
   # <task title>

   ## Task
   <one or two lines: what was asked>

   ## Done
   - <what changed and why>

   ## Files changed
   - path/to/file - <what changed>

   ## Tests run + result
   - \`<command>\` - <pass / fail counts, or why tests were not run>

   ## Open issues / next steps
   - <anything left, risky or worth a review; "none" if nothing>
   \`\`\`

3. Call the Orrery MCP tool \`hand_back\` with \`report\` = the report path (relative to the project root) and
   \`summary\` = one line for the other agent.
4. Stop. Do not commit or push; the other agent reviews the diff first.

If \`hand_back\` is missing or fails, say so and print the report path so the user can pass it on.
`

export const DELEGATE_SKILL = `---
name: orrery-delegate
description: Hand a side task to a DeepSeek (Codewhale) pane through Orrery and review what comes back. Use for secondary code, test generation, clone-app-re reverse-engineering / spec steps or bulk mechanical edits - not for architecture decisions, security-sensitive code or the final review.
metadata:
  ${MANAGED_MARK}
---

# Delegate to DeepSeek

## When
- Good fits: side code next to your main task, writing or generating tests, clone-app-re RE / spec steps,
  bulk mechanical edits across many files.
- Keep for yourself: architecture decisions, security-sensitive code (auth, secrets, payments), the final review.

## How
Call the Orrery MCP tool \`open_session\` with \`agent: "deepseek"\`, \`cwd\` = the project root and a prompt like:

\`\`\`text
Goal: <one sentence>
Context files: <paths to read first>
Allowed files: <paths or globs you may change; nothing else>
Test command: <exact command>
Done criteria: <what must be true>
When finished follow the orrery-handoff skill and call hand_back.
\`\`\`

The prompt is prefilled in the new pane; the user presses Enter to start it. Keep working on your own task.

## When the hand-back arrives
Orrery types a message with the report path into your pane once you are idle.
1. Read the report.
2. Review the diff of the listed files (\`git diff -- <files>\`); check nothing outside the allowed files changed.
3. Run the test command yourself.
4. Fix small issues directly, or send a follow-up task the same way. Then continue your own work.
`

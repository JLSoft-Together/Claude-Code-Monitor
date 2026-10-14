/**
 * The shape of one built-in agent, and the builders its file uses to spell its
 * launch flags and runtime values. Pure, and imports nothing: the main process
 * compiles this directory too (`tsconfig.electron.json`), so no DOM, no
 * assets, no signals.
 *
 * **Every flag in an agent file is read off that CLI's own `--help` on the
 * owner's machine**, with the version and date written in the file. Nothing is
 * inferred from another agent, and an undocumented flag is `null` rather than
 * a guess — a wrong flag is typed verbatim into a live shell.
 *
 * **Every install command is read off the vendor's official install
 * documentation** for the same reason: it is typed verbatim into a live shell.
 * The data carries the page it was read off and the day it was read, and an
 * unverified command is `null` rather than a guess. A Windows command runs in
 * PowerShell, `pwsh` 7 or else Windows PowerShell 5.1, so it uses no `&&` or
 * `||` and is never derived from the macOS form.
 */

/** One vendor-documented install command for one OS, typed verbatim into a Deck pane. */
export interface InstallCommand {
  /** Exactly the vendor's text: one line, no leading/trailing whitespace. */
  readonly command: string;
  /** The official page it was read off (https). */
  readonly source: string;
  /** The day it was read, `YYYY-MM-DD`. */
  readonly checked: string;
}

/** Per-OS install commands. `null` = no verified command for that OS (Deck offers `Get`). */
export interface AgentInstall {
  /** Run by the user's login shell (zsh by default). */
  readonly macos: InstallCommand | null;
  /** Run by PowerShell: `pwsh` 7, else Windows PowerShell 5.1 — so no `&&` / `||`. */
  readonly windows: InstallCommand | null;
}

export interface BuiltinAgent {
  /** Also the binary name and the bare command — see `agent-catalog.ts`. */
  readonly id: string;
  readonly label: string;
  /**
   * The command Deck launches this agent with out of the box, flags included.
   *
   * This is a RECOMMENDATION shipped with the app, not a user setting: a fresh
   * install shows it immediately and can launch it without anyone typing a
   * flag. A user preset for the same agent replaces it; nothing merges.
   *
   * Several of these skip the agent's own confirmation prompts, which is the
   * point — Deck exists to run agents that keep working — but it is also why
   * every one of them is spelled out on screen rather than hidden behind a
   * label, and why the row can be disabled.
   *
   * Absent = launch the bare binary.
   */
  readonly defaultCommand?: string;
  /** Opened by the `Get` link of a missing agent with no install command. */
  readonly url: string;
  /** Absent only on withdrawn agents. Never set for custom agents. */
  readonly install?: AgentInstall;
}

/** One value a control can hold. `forms[0]` is written; every form is read. */
export interface LaunchFlagOption {
  readonly value: string;
  readonly label: string;
  readonly forms: readonly (readonly string[])[];
}

/** One control. A `toggle` has exactly one option: on means its flag is present. */
export interface LaunchFlag {
  readonly id: string;
  readonly label: string;
  readonly desc: string;
  readonly kind: "toggle" | "menu";
  readonly options: readonly LaunchFlagOption[];
}

export interface RuntimeValue {
  readonly value: string;
  readonly label: string;
}

/** What the CLI takes for model and reasoning effort. */
export interface AgentRuntime {
  /** e.g. `--model`; null when the CLI documents no model flag. */
  readonly modelFlag: string | null;
  /** Seed values quoted from the CLI's own `--help`; usually empty. */
  readonly models: readonly RuntimeValue[];
  /** e.g. `--effort`; null when the CLI documents none. */
  readonly effortFlag: string | null;
  /** Closed set — an effort outside it is refused, never passed through. */
  readonly efforts: readonly RuntimeValue[];
}

/** The command a restored pane types to re-enter this agent's conversation. */
export interface ResumeForms {
  /** An exact session id, already checked against `SESSION_REF_SAFE`. */
  readonly id: (id: string) => string;
  /** The CLI's "continue the latest conversation" form. */
  readonly latest: string;
  /** A fresh session, when nothing resolved. */
  readonly bare: string;
}

export interface AgentDefinition extends BuiltinAgent {
  /**
   * A tab-dot colour, as a theme custom property — never a literal. Absent =
   * the faint text colour every unknown agent gets (`process-info.ts`).
   */
  readonly dotColor?: string;
  /**
   * Kept as data, switched off everywhere: nothing probes, lists, classifies,
   * resumes or counts it. Bringing the agent back is deleting this line.
   */
  readonly withdrawn?: true;
  readonly resume: ResumeForms;
  readonly runtime: AgentRuntime;
  /** The controls Settings → Agents offers; see `launch-flags.ts`. */
  readonly launchFlags: readonly LaunchFlag[];
}

/** A switch whose flag is present when on. Every form is read; the first is written. */
export const toggle = (
  id: string,
  label: string,
  desc: string,
  ...forms: readonly (readonly string[])[]
): LaunchFlag => ({ id, label, desc, kind: "toggle", options: [{ value: "on", label, forms }] });

/** One menu choice, written as `forms[0]` and read in any of its forms. */
export const option = (
  value: string,
  label: string,
  ...forms: readonly (readonly string[])[]
): LaunchFlagOption => ({ value, label, forms });

/** A `--flag value` option, also read as `-x value` when the CLI has a short form. */
export const valued = (flags: readonly string[], value: string, label: string): LaunchFlagOption =>
  option(value, label, ...flags.map((flag) => [flag, value]));

/** Every value is its own label: these are what the user types at the CLI. */
export function values(...raw: readonly string[]): readonly RuntimeValue[] {
  return raw.map((value) => ({ value, label: value }));
}

/**
 * A built-in whose CLI was not installed when it was added, so no `--help`
 * could be read: launch the bare binary, offer no flag controls and no model or
 * effort, and resume by relaunching bare. Each of those is `null`/empty rather
 * than a guess, per the header above; the agent's own file replaces this
 * with a full definition once someone with the CLI installed reads its help.
 */
export function unreadAgent(
  agent: Pick<BuiltinAgent, "id" | "label" | "url" | "install">,
): AgentDefinition {
  return {
    ...agent,
    resume: { id: () => agent.id, latest: agent.id, bare: agent.id },
    runtime: { modelFlag: null, models: [], effortFlag: null, efforts: [] },
    launchFlags: [],
  };
}

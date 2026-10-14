/**
 * Which stored Signals switches count as the user's choice (DECK-102).
 *
 * 1.1.x shipped every adapter on and saved the whole settings object on any
 * change, so a file it wrote says `true` for all three whether or not anyone
 * touched the switch. 1.2.0 turned the defaults off but kept any stored
 * boolean, so those unchosen `true`s kept Deck's hooks in the user's Claude
 * and Codex config. A settings file now carries `signalAdaptersRevision`;
 * without the current one, every adapter reads as off.
 *
 * The renderer's settings validator and main's boot-time hook sync share this
 * rule, because main reads the stored file before any window has validated it.
 * Pure on purpose: main imports it.
 */
export const SIGNAL_ADAPTERS_REVISION = 2;

/** Whether `settings` were saved under the current revision of the rule. */
export function signalChoicesAreCurrent(settings: Readonly<Record<string, unknown>>): boolean {
  return settings.signalAdaptersRevision === SIGNAL_ADAPTERS_REVISION;
}

/**
 * The settings patch for a Signals switch. It carries the revision because
 * main merges a patch into the STORED file: adapters alone, merged into a file
 * saved before the revision, would read as unchosen again — main would register
 * nothing and the merged broadcast would flip the switch back off.
 */
export function signalAdaptersPatch<T>(adapters: T): {
  readonly agentSignalAdapters: T;
  readonly signalAdaptersRevision: number;
} {
  return { agentSignalAdapters: adapters, signalAdaptersRevision: SIGNAL_ADAPTERS_REVISION };
}

/** Whether stored (unvalidated) `settings` switch `agent`'s adapter on as a user choice. */
export function storedSignalAdapterOn(settings: unknown, agent: string): boolean {
  if (typeof settings !== "object" || settings === null) return false;
  const source = settings as Record<string, unknown>;
  const adapters = source.agentSignalAdapters;
  return (
    signalChoicesAreCurrent(source) &&
    typeof adapters === "object" &&
    adapters !== null &&
    (adapters as Record<string, unknown>)[agent] === true
  );
}

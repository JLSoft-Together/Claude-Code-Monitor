/**
 * Home-directory scrubbing for crash reports (DECK-99).
 *
 * The usage-analytics contract (docs/internals/telemetry.md) promises that no
 * file path leaves the machine, and a crash report is the one payload that
 * cannot avoid carrying paths: stack frames, error messages and the
 * renderer's page URL all name files. The home directory is the part of a
 * path that identifies the person — `/Users/<name>`, `C:\Users\<name>` — so
 * every occurrence becomes `~` before the event is sent. Paths inside the
 * app bundle stay readable because they are Deck's own files.
 *
 * Main's `beforeSend` runs this over renderer events too: the renderer SDK
 * hands its events to main, which captures them through the same client.
 */

const HOME_REPLACEMENT = "~";

/**
 * Every spelling a home directory takes inside an event: as the OS reports
 * it, with forward slashes (Windows paths inside `file:` URLs), and
 * percent-encoded (a username with a space, inside a URL). Longest first, so
 * a longer spelling is never half-replaced by a shorter one it contains.
 */
export function homeDirectoryVariants(home: string): readonly string[] {
  const forward = home.replace(/\\/g, "/");
  const variants = new Set([home, forward, encodeURI(forward)]);
  return [...variants].sort((a, b) => b.length - a.length);
}

function scrubString(value: string, variants: readonly string[]): string {
  return variants.reduce((text, variant) => text.split(variant).join(HOME_REPLACEMENT), value);
}

function scrubValue(value: unknown, variants: readonly string[]): unknown {
  if (typeof value === "string") {
    return scrubString(value, variants);
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, variants));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        scrubString(key, variants),
        scrubValue(item, variants),
      ]),
    );
  }
  return value;
}

/**
 * A copy of `event` with every home-directory spelling rewritten to `~`, in
 * values and keys alike. The input is never modified. An empty `home` — the
 * OS could not name one — returns the event unchanged rather than inserting
 * `~` between every character.
 */
export function scrubHomeDirectory<T>(event: T, home: string): T {
  if (home.length === 0) {
    return event;
  }
  return scrubValue(event, homeDirectoryVariants(home)) as T;
}

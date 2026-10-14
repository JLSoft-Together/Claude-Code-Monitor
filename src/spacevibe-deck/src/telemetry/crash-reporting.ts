/**
 * Renderer half of crash reporting (DECK-99). Electron host only.
 *
 * The renderer SDK has no DSN and no transport of its own: it hands every
 * event to main over the SDK's custom protocol, and main decides whether to
 * send (only in a packaged build) and scrubs the home directory first — see
 * `electron/crash-reporting/`. On Tauri and in the browser preview there is
 * no `__deckHost` and nothing is loaded, so the SDK stays out of those
 * renderers entirely; the dynamic import also keeps it out of the main chunk.
 *
 * Breadcrumbs are off: their defaults record console lines, clicks and
 * fetches, and a console line in a terminal app can be terminal output —
 * which docs/internals/telemetry.md promises never leaves the machine.
 */

const electronHost = (): boolean =>
  (globalThis as { __deckHost?: unknown }).__deckHost !== undefined;

export async function initRendererCrashReporting(): Promise<void> {
  if (!electronHost()) {
    return;
  }
  const Sentry = await import("@sentry/electron/renderer");
  Sentry.init({
    sendDefaultPii: false,
    maxBreadcrumbs: 0,
    integrations: (defaults) =>
      defaults.filter((integration) => integration.name !== "Breadcrumbs"),
  });
}

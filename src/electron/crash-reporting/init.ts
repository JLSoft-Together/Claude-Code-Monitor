/**
 * Crash and error reporting to Sentry (DECK-99). Electron host only.
 *
 * Follows the analytics policy: always on in a packaged build, with no
 * opt-out (owner-decided 2026-09-14), and disclosed in Settings → Privacy and
 * the privacy notice. Development and unpackaged runs initialize the SDK with
 * `enabled: false`, so the renderer's protocol still has an answer but
 * nothing is sent.
 *
 * What may leave the machine is decided HERE, by an allowlist rather than by
 * trusting the SDK's defaults, because several defaults collide with the
 * promises in docs/internals/telemetry.md:
 *  - `LocalVariables` attaches the values of local variables to stack frames —
 *    in a terminal app those can be terminal output, prompts or file contents.
 *  - `SentryMinidump` uploads native crash dumps, which carry raw process
 *    memory.
 *  - `Context` adds locale and timezone; `ElectronBreadcrumbs`,
 *    `ElectronNet` and `Console` record window events, request URLs and
 *    console lines; `MainProcessSession` pings on every launch.
 * Anything not named below is dropped, including integrations a future SDK
 * version adds by default.
 */
import os from "node:os";
import { app } from "electron";
import { init, IPCMode } from "@sentry/electron/main";
import { scrubHomeDirectory } from "./scrub-paths";

/** Project `spacevibe-deck` in org `spacevibe`. A DSN is public by design. */
export const CRASH_REPORTING_DSN =
  "https://183af6186a66ee17e8aabaf6e7780d3c@o4512085105049600.ingest.us.sentry.io/4512085122678784";

/**
 * `productName` in electron-builder.release.yml. A local `electron:package`
 * build is also packaged — so it sends — but is named `Deck Electron`, and
 * tagging it `local` keeps smoke runs out of the production view.
 */
const RELEASE_APP_NAME = "SpaceVibe Deck";

const KEPT_INTEGRATIONS: ReadonlySet<string> = new Set([
  "OnUncaughtException",
  "OnUnhandledRejection",
  "LinkedErrors",
  "EventFilters",
  "FunctionToString",
  // Deck's own source lines around a frame, read from the app bundle.
  "ContextLines",
  // App name and version, Electron/Chrome/Node versions, architecture.
  "ElectronContext",
  // A message when a renderer or helper process dies abnormally.
  "ChildProcess",
  // Rewrites app-bundle paths to `app:///`; runs after the context above.
  "NormalizePaths",
]);

/** Must run before `app.whenReady()`: the renderer protocol is registered at init. */
export function initCrashReporting(): void {
  const home = os.homedir();
  init({
    dsn: CRASH_REPORTING_DSN,
    enabled: app.isPackaged,
    release: `spacevibe-deck@${app.getVersion()}`,
    environment: app.getName() === RELEASE_APP_NAME ? "production" : "local",
    sendDefaultPii: false,
    maxBreadcrumbs: 0,
    // No preload injection: `electron/preload.ts` stays the renderer's only
    // door, and the SDK's custom protocol on the default session carries
    // renderer events instead. The browser panel runs in its own partition,
    // so pages loaded there cannot reach it.
    ipcMode: IPCMode.Protocol,
    integrations: (defaults) =>
      defaults.filter((integration) => KEPT_INTEGRATIONS.has(integration.name)),
    beforeSend: (event) => scrubHomeDirectory(event, home),
  });
}

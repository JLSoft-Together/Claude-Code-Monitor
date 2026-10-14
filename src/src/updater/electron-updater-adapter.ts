/**
 * The renderer's door to the host's updater.
 *
 * It runs in two places and must be right in both:
 *
 *  - **Electron**, where the bridge exists and `electron/updater/updater.ts`
 *    answers. An unpackaged or unsigned run answers `unsupported`, which the
 *    menu reports as "Updates are unavailable in this build" instead of the
 *    "SpaceVibe Deck is up to date" this host used to claim.
 *  - **Browser `npm run dev`**, where there is no bridge. Absent bridge resolves
 *    to `null` fail-soft, like every other `src/host/` facade: a preview shell
 *    with no host must not throw an update error at the user.
 */
import { relaunch as relaunchElectron } from "../host/shell-host";
import { invoke } from "../host/bridge";
import {
  UPDATE_UNSUPPORTED,
  UpdateInstallError,
  type PendingUpdate,
  type UpdateUnsupported,
} from "./update-controller";

type UpdateCheckReply =
  | { readonly status: "unsupported" }
  | { readonly status: "current" }
  | {
      readonly status: "available";
      readonly currentVersion: string;
      readonly version: string;
      readonly notes: string | null;
    };

function hasDeckHost(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    (globalThis as { __deckHost?: unknown }).__deckHost !== undefined
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

/**
 * Validate what main sent (C7).
 *
 * A malformed reply THROWS, so the controller reports "Couldn't check for
 * updates" — the one thing this boundary must never do is invent a "current"
 * out of a shape it did not understand, which is the exact class of false
 * reassurance this whole change exists to end.
 */
export function parseUpdateCheckReply(value: unknown): UpdateCheckReply {
  if (!isRecord(value)) {
    throw new Error("Update check reply is not an object");
  }
  if (value.status === "unsupported") {
    return { status: "unsupported" };
  }
  if (value.status === "current") {
    return { status: "current" };
  }
  if (value.status !== "available") {
    throw new Error(`Update check reply has an unknown status: ${String(value.status)}`);
  }
  if (
    typeof value.version !== "string" ||
    typeof value.currentVersion !== "string" ||
    value.version === "" ||
    value.currentVersion === ""
  ) {
    throw new Error("Update check reply is missing a version");
  }
  const notes = value.notes;
  if (notes !== null && typeof notes !== "string") {
    throw new Error("Update check reply has invalid release notes");
  }
  return {
    status: "available",
    currentVersion: value.currentVersion,
    version: value.version,
    notes,
  };
}

export async function checkForUpdate(): Promise<PendingUpdate | UpdateUnsupported | null> {
  if (!hasDeckHost()) {
    return null;
  }
  const reply = parseUpdateCheckReply(await invoke<unknown>("update_check"));
  if (reply.status === "unsupported") {
    return UPDATE_UNSUPPORTED;
  }
  if (reply.status === "current") {
    return null;
  }
  return Object.freeze({
    currentVersion: reply.currentVersion,
    version: reply.version,
    notes: reply.notes,
    download: () => invoke<void>("update_download"),
    // Resolves only on FAILURE. A successful install hands the app to
    // Squirrel or the NSIS installer, both of which relaunch Deck themselves,
    // and this process is gone before a reply could arrive — so the
    // controller's own relaunch step is deliberately never reached here.
    install: async () => {
      const installReply = await invoke<unknown>("update_install");
      if (
        isRecord(installReply) &&
        installReply.status === "install-failed" &&
        installReply.retryable === false &&
        typeof installReply.message === "string"
      ) {
        throw new UpdateInstallError(installReply.message, false);
      }
      // A successful Electron install ends this process and never replies.
      throw new UpdateInstallError(
        "Unexpected reply from the update installer. Quit and reopen Deck.",
        false,
      );
    },
  });
}

export async function relaunchDeck(): Promise<void> {
  return relaunchElectron();
}

/** Keep renderer diagnostics local on Electron. */
export function reportUpdateError(message: string, error: unknown): void {
  console.error(`${message}:`, error);
  if (!hasDeckHost()) return;
  const operation = /check/i.test(message)
    ? "check"
    : /download/i.test(message)
      ? "download"
      : "install";
  const limit = 2048;
  void (async () => {
    try {
      await invoke<void>("update_report_error", {
        operation,
        name: (error instanceof Error ? error.name : "Error").slice(0, limit),
        message: `${message}: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          limit,
        ),
      });
    } catch (logError: unknown) {
      console.error("Could not persist updater error:", logError);
    }
  })();
}

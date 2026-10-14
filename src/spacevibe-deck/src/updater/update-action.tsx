import { getDesktopEnvironment, type DesktopPlatform } from "../lib/platform";
import { manualUpdateHint } from "./update-attempt";
import type { UpdatePhase, UpdateView } from "./update-controller";

interface UpdateActionProps {
  readonly view: UpdateView;
  readonly onCheck: () => void;
  readonly platform?: DesktopPlatform;
  readonly onDownload: () => void;
  readonly onInstall: () => void;
  readonly onRelaunch: () => void;
}

const LABELS: Readonly<Record<Exclude<UpdatePhase, "hidden">, string>> = {
  "check-failed": "Update check failed · Retry",
  available: "Update",
  downloading: "Downloading…",
  downloaded: "Install & Relaunch",
  "download-failed": "Retry Update",
  installing: "Installing…",
  "install-failed": "Retry Install",
  "relaunch-failed": "Relaunch",
};

const ANNOUNCEMENTS: Readonly<Record<Exclude<UpdatePhase, "hidden">, string>> = {
  "check-failed": "Update check failed. Retry checking for updates.",
  available: "Deck update available.",
  downloading: "Downloading Deck update.",
  downloaded: "Deck update downloaded. Ready to install and relaunch.",
  "download-failed": "Update download failed. Retry available.",
  installing: "Installing Deck update.",
  "install-failed": "Update installation failed. Retry available.",
  "relaunch-failed": "Deck could not relaunch. Relaunch available.",
};

function accessibleName(view: UpdateView): string {
  const versions = `update ${view.availableVersion} (current ${view.currentVersion})`;
  switch (view.phase) {
    case "check-failed":
      return "Update check failed. Retry checking for updates.";
    case "downloaded":
      return `Install update ${view.availableVersion} and relaunch Deck (current ${view.currentVersion})`;
    case "install-failed":
      return view.installRetryable === false
        ? "Update installation failed. Quit and reopen Deck."
        : `Retry installing ${versions}`;
    case "relaunch-failed":
      return "Relaunch Deck after installing update";
    case "downloading":
      return `Downloading ${versions}`;
    case "installing":
      return `Installing ${versions}`;
    case "download-failed":
      return `Retry downloading ${versions}`;
    case "available":
      return `Download ${versions}`;
    case "hidden":
      return "";
  }
}

function actionForPhase(props: UpdateActionProps): () => void {
  if (props.view.phase === "check-failed") return props.onCheck;
  if (props.view.phase === "relaunch-failed") {
    return props.onRelaunch;
  }
  if (props.view.phase === "downloaded" || props.view.phase === "install-failed") {
    return props.onInstall;
  }
  return props.onDownload;
}

export function UpdateAction(props: UpdateActionProps) {
  const { view } = props;
  if (view.phase === "hidden") {
    return null;
  }
  const busy = view.phase === "downloading" || view.phase === "installing";
  const failed = view.phase.endsWith("-failed");
  const cannotRetry = view.phase === "install-failed" && view.installRetryable === false;
  const label = cannotRetry ? "Install failed · Reopen Deck" : LABELS[view.phase];
  const recovery =
    view.phase === "download-failed" || view.phase === "install-failed"
      ? manualUpdateHint(props.platform ?? getDesktopEnvironment().platform)
      : "";
  const announcement = cannotRetry
    ? "Update installation failed. Quit and reopen Deck."
    : ANNOUNCEMENTS[view.phase];
  const title = [accessibleName(view), recovery, view.notes].filter(Boolean).join(" — ");
  return (
    <span class="update-action-wrap">
      <button
        type="button"
        class={`update-action ${failed ? "update-action--failed" : ""}`}
        disabled={busy}
        aria-disabled={cannotRetry ? "true" : undefined}
        aria-busy={busy ? "true" : undefined}
        aria-label={accessibleName(view)}
        title={title}
        onClick={cannotRetry ? undefined : actionForPhase(props)}
      >
        <span class="update-action__full">{label}</span>
        {view.phase === "downloaded" ? (
          <span class="update-action__compact" aria-hidden="true">
            Relaunch
          </span>
        ) : null}
      </button>
      <span class="update-action__live" aria-live="polite" aria-atomic="true">
        {[announcement, recovery].filter(Boolean).join(" ")}
      </span>
    </span>
  );
}

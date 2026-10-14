import { BRAND_ICON_SRC } from "./appwin.js";
import { RELEASES_URL, REPO_URL, WINDOWS_FALLBACK_URL } from "./download-links.js";
import { initialInstallPlatform } from "./install-command.js";
import { renderInstallIcon } from "./os-icons.js";
import { CHANGELOG_URL, FEEDBACK_URL, LANDING_URL } from "./site-urls.js";

const PARTNER_MARK_SRC = "/landing-prototype/assets/partner-mark.svg";

/** Where Download points before the release API answers, per platform. */
const DOWNLOAD_FALLBACK = { mac: RELEASES_URL, win: WINDOWS_FALLBACK_URL };

function renderGithubIcon() {
  return `
    <svg class="a-github-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.1-.55-.17-.55-.38
        0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95
        0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27
        -.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12
        -.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07
        -.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13
        .16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/>
    </svg>
  `;
}

function renderBrandMark(copy) {
  return `
    <span class="a-brand-mark" aria-hidden="true">
      <img class="a-partner-mark" src="${PARTNER_MARK_SRC}" alt="" width="22" height="22" />
      <span class="a-brand-divider"></span>
      <img class="a-brand-icon" src="${BRAND_ICON_SRC}" alt="" width="28" height="28" />
    </span>
    <strong data-copy="navProduct">${copy.navProduct}</strong>
  `;
}

/**
 * The page's top bar. The feedback board's three dots ride its nav link
 * (2026-10-10) rather than a second pill above the headline: same
 * destination, one place to find it.
 */
export function renderTopbar(copy) {
  return `
    <header class="a-topbar">
      <a class="a-topbar__brand" href="${LANDING_URL}" aria-label="${copy.navProduct}">
        ${renderBrandMark(copy)}
      </a>
      <a class="a-topbar__changelog" href="${CHANGELOG_URL}">
        <span data-copy="navChangelog">${copy.navChangelog}</span>
      </a>
      <a class="a-topbar__changelog a-topbar__feedback" href="${FEEDBACK_URL}">
        <span class="a-topbar__dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <span data-copy="navFeedback">${copy.navFeedback}</span>
      </a>
      <a class="a-topbar__github" href="${REPO_URL}" target="_blank" rel="noreferrer">
        ${renderGithubIcon()}
        <span data-copy="navGithub">${copy.navGithub}</span>
        <span aria-hidden="true">↗</span>
      </a>
      <a class="a-primary-cta a-topbar__download" href="${RELEASES_URL}" target="_blank" rel="noreferrer"
        data-download-os="mac">
        <span data-copy="navDownload">${copy.navDownload}</span>
        ${renderInstallIcon()}
      </a>
    </header>
  `;
}

/**
 * Point Download at the visitor's own build. The markup ships the macOS
 * default so the static page works; `upgradeReleaseLinks` later swaps the
 * fallback for the file itself, keyed by `data-download-os`.
 *
 * @param {ParentNode} root
 */
export function mountTopbarDownload(root) {
  const link = root.querySelector(".a-topbar__download");

  if (!link) {
    throw new Error("Top bar Download link is missing.");
  }

  const os = initialInstallPlatform();
  link.dataset.downloadOs = os;
  link.href = DOWNLOAD_FALLBACK[os];
}

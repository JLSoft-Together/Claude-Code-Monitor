/**
 * The closing band: the page's last promise set at chapter scale, three proofs
 * as a ruled band, then the downloads.
 *
 * The analytics disclosure is visible text with a link to the privacy notice,
 * never only a tooltip: the claim above it ("your work stays on your machine")
 * is not honest if the one exception hides behind a hover. Every download
 * anchor keeps its `data-copy="downloadMac|Win"` child, which is how
 * `upgradeReleaseLinks` finds it and retargets it at the newest stable
 * installer.
 */

import { RELEASES_URL, REPO_URL, WINDOWS_FALLBACK_URL } from "../download-links.js";
import { initialInstallPlatform } from "../install-command.js";
import { renderAppleIcon, renderInstallIcon, renderWindowsIcon } from "../os-icons.js";
import { PRIVACY_URL } from "../site-urls.js";

/** `key` names the copy (`proof<key>Title`); `token` is the proof as a literal. */
const PROOFS = [
  { key: "Pty", token: "$SHELL -l" },
  { key: "Open", token: "MIT" },
  { key: "Local", token: "~/" },
];

const ATTR_ESCAPES = { "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" };
const esc = (text) => String(text).replace(/[&"<>]/g, (char) => ATTR_ESCAPES[char]);

/** Pty and Open keep their long explanation in a tooltip; Local never does. */
const tip = (copy, key) => (key === "Local" ? "" : ` title="${esc(copy[`proof${key}Body`])}"`);

function renderLocalNote(copy) {
  return `<span data-copy="proofLocalNote">${copy.proofLocalNote}</span> <a class="finale__privacy" href="${PRIVACY_URL}" data-copy="privacyLink">${copy.privacyLink}</a>`;
}

const DOWNLOADS = {
  mac: { href: RELEASES_URL, icon: renderAppleIcon, copyKey: "downloadMac" },
  win: { href: WINDOWS_FALLBACK_URL, icon: renderWindowsIcon, copyKey: "downloadWin" },
};

/** One download per OS. macOS is the primary until mount says otherwise. */
function renderDownload(os, copy) {
  const { href, icon, copyKey } = DOWNLOADS[os];

  return `
    <div class="finale__dl" data-os="${os}">
      <a class="finale__btn ${os === "mac" ? "a-primary-cta" : "a-quiet-cta"}" href="${href}" target="_blank" rel="noreferrer">
        <span class="a-cta-lead">
          ${icon()}
          <span data-copy="${copyKey}">${copy[copyKey]}</span>
        </span>
        <span class="a-cta-trail">${renderInstallIcon()}</span>
      </a>
    </div>
  `;
}

function renderCell({ key, token }, index, copy) {
  return `
    <div class="finale__cell" data-reveal style="--i: ${index}; --reveal-delay: ${index * 90}ms"${tip(copy, key)}>
      <strong class="finale__token">${token}</strong>
      <span class="finale__label">
        <i class="finale__tick" aria-hidden="true">✓</i>
        <span data-copy="proof${key}Title">${copy[`proof${key}Title`]}</span>
      </span>
      ${key === "Local" ? `<p class="finale__note">${renderLocalNote(copy)}</p>` : ""}
    </div>
  `;
}

export function renderFinale(copy) {
  return `
    <footer class="finale">
      <div class="finale__frame finale__head">
        <h2 class="finale__title" data-reveal data-copy="finaleTitle">${copy.finaleTitle}</h2>
      </div>
      <div class="finale__frame finale__band">
        ${PROOFS.map((proof, index) => renderCell(proof, index, copy)).join("")}
      </div>
      <div class="finale__frame finale__foot">
        <div class="finale__ctas" data-reveal style="--reveal-delay: 120ms">
          ${renderDownload("mac", copy)}
          ${renderDownload("win", copy)}
          <a class="finale__gh" href="${REPO_URL}" target="_blank" rel="noreferrer">
            <span data-copy="secondaryCta">${copy.secondaryCta}</span>
            <span class="finale__gh-arrow" aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
    </footer>
  `;
}

/**
 * Put the visitor's platform first, the way the hero's `mountInstallOrder`
 * does: toggle the two button classes; CSS `order` moves Windows to the front.
 */
export function mountFinale(section) {
  const os = initialInstallPlatform();
  const ctas = section.querySelector(".finale__ctas");

  if (!ctas) {
    throw new Error("Finale markup is missing.");
  }

  ctas.dataset.os = os;

  for (const download of ctas.querySelectorAll(".finale__dl")) {
    const primary = download.dataset.os === os;
    const anchor = download.querySelector("a");

    anchor.classList.toggle("a-primary-cta", primary);
    anchor.classList.toggle("a-quiet-cta", !primary);
  }
}

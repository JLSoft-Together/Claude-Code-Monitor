import { BRAND_ICON_SRC } from "./appwin.js";
import { refreshBoardTimes, renderBoardSection } from "./feedback-board-view.js";
import { renderComposer } from "./feedback-form-view.js";
import { LANDING_URL } from "./site-urls.js";

const PARTNER_MARK_SRC = "/landing-prototype/assets/partner-mark.svg";

// The topbar reuses the changelog's classes so the two secondary pages cannot
// drift apart.
function renderTopbar(copy, locale) {
  return `
    <header class="changelog-topbar">
      <a class="changelog-brand" href="${LANDING_URL}" aria-label="${copy.navProduct}">
        <span class="changelog-brand__marks" aria-hidden="true">
          <img src="${PARTNER_MARK_SRC}" alt="" width="22" height="22" />
          <span></span>
          <img src="${BRAND_ICON_SRC}" alt="" width="28" height="28" />
        </span>
        <strong data-copy="navProduct">${copy.navProduct}</strong>
      </a>
      <div class="changelog-topbar__lang" role="group" aria-label="${copy.localeLabel}" data-active="${locale}">
        <span class="changelog-topbar__lang-thumb" aria-hidden="true"></span>
        <button type="button" data-locale="en" aria-pressed="${locale === "en"}">EN</button>
        <button type="button" data-locale="vi" aria-pressed="${locale === "vi"}">VI</button>
      </div>
      <a class="changelog-back" href="${LANDING_URL}">
        <span aria-hidden="true">←</span>
        <span data-copy="changelogBack">${copy.changelogBack}</span>
      </a>
    </header>
  `;
}

export function renderFeedbackShell(root, copy, locale) {
  root.className = "changelog-page feedback-page";
  root.dataset.boardState = "loading";
  root.innerHTML = `
    ${renderTopbar(copy, locale)}

    <section class="feedback-intro" aria-labelledby="feedback-title">
      <h1 id="feedback-title" data-copy="feedbackTitle">${copy.feedbackTitle}</h1>
      <p class="feedback-intro__body" data-copy="feedbackIntro">${copy.feedbackIntro}</p>
    </section>

    <div class="feedback-workspace">
      ${renderComposer(copy)}
      ${renderBoardSection(copy)}
    </div>
  `;
}

export function updateFeedbackLocale(root, copy, locale) {
  for (const node of root.querySelectorAll("[data-copy]")) {
    const text = copy[node.dataset.copy];

    if (typeof text === "string") {
      node.firstChild?.remove();
      node.prepend(document.createTextNode(text));
    }
  }

  for (const node of root.querySelectorAll("[data-copy-placeholder]")) {
    node.placeholder = copy[node.dataset.copyPlaceholder] ?? node.placeholder;
  }

  root.querySelector(".changelog-brand")?.setAttribute("aria-label", copy.navProduct);
  root.querySelector(".feedback-tabs")?.setAttribute("aria-label", copy.feedbackBoardTitle);

  const langGroup = root.querySelector(".changelog-topbar__lang");

  if (langGroup) {
    langGroup.setAttribute("aria-label", copy.localeLabel);
    langGroup.dataset.active = locale;

    for (const button of langGroup.querySelectorAll("button[data-locale]")) {
      button.setAttribute("aria-pressed", String(button.dataset.locale === locale));
    }
  }

  refreshBoardTimes(root, locale);
}

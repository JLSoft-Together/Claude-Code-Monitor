/**
 * The page below the hero: the muted demo loop (currently hidden), the feature
 * chapters, the closing band (finale.js) and the site footer, all inside one
 * `<section class="tour">` that carries the dark ground and the light pools
 * behind the last two.
 *
 * The features were a scroll tour until 2026-08-19, then seven stacked panels
 * each carrying its own app-window mock. Since 2026-10-12 they are three
 * chapters of widgets (layout-chapters.js), so the hero holds the page's only
 * app window. The section keeps the name `.tour`.
 */

import { BRAND_ICON_SRC } from "../appwin.js";
import { mountDemoLoop, renderDemoLoop } from "../demo-loop.js";
import { RELEASES_URL, REPO_URL, WINDOWS_FALLBACK_URL } from "../download-links.js";
import { FEEDBACK_URL } from "../site-urls.js";
import { mountFinale, renderFinale } from "./finale.js";
import { renderChapters } from "./layout-chapters.js";

/** Anchor on the first feature chapter; the hero CTA and the footer link to it. */
const FEATURES_ID = "features";

/**
 * Hidden until the loop is re-recorded on the current app (owner, 2026-10-12):
 * the recording still shows the card-era rail under a 2.10 hero. The module,
 * its styles and its assets stay so the switch can come back on.
 */
const SHOW_DEMO_LOOP = false;

/**
 * Reveal-on-scroll for every `[data-reveal]` below the hero — chapter heads,
 * widgets, the stat band and the closing band. Each sheet owns what the hidden
 * and revealed states look like and its reduced-motion end state.
 */
function mountReveal(section) {
  const targets = [...section.querySelectorAll("[data-reveal]")];
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.25 },
  );

  targets.forEach((target) => observer.observe(target));

  return () => observer.disconnect();
}

function renderFooter(copy) {
  return `
    <footer class="site-footer">
      <div class="site-footer__glow" aria-hidden="true"></div>
      <div class="site-footer__inner">
        <div class="site-footer__brand">
          <span class="site-footer__mark">
            <img src="${BRAND_ICON_SRC}" alt="" width="30" height="30" />
            <strong data-copy="navProduct">${copy.navProduct}</strong>
          </span>
          <p class="site-footer__tagline" data-copy="footerTagline">${copy.footerTagline}</p>
        </div>
        <nav class="site-footer__col" aria-label="${copy.footerColProduct}">
          <span class="site-footer__coltitle" data-copy="footerColProduct">${copy.footerColProduct}</span>
          <a href="${RELEASES_URL}" target="_blank" rel="noreferrer" data-copy="downloadMac">${copy.downloadMac}</a>
          <a href="${WINDOWS_FALLBACK_URL}" target="_blank" rel="noreferrer" data-copy="downloadWin">${copy.downloadWin}</a>
          <a class="site-footer__link" href="#${FEATURES_ID}" data-copy="seeFeatures">${copy.seeFeatures}</a>
        </nav>
        <nav class="site-footer__col" aria-label="${copy.footerColProject}">
          <span class="site-footer__coltitle" data-copy="footerColProject">${copy.footerColProject}</span>
          <a href="${REPO_URL}" target="_blank" rel="noreferrer" data-copy="navGithub">${copy.navGithub}</a>
          <a href="${REPO_URL}/releases" target="_blank" rel="noreferrer" data-copy="footerReleases">${copy.footerReleases}</a>
          <a href="${FEEDBACK_URL}" data-copy="navFeedback">${copy.navFeedback}</a>
          <a href="${REPO_URL}/issues" target="_blank" rel="noreferrer" data-copy="footerIssues">${copy.footerIssues}</a>
          <a href="${REPO_URL}/blob/main/LICENSE" target="_blank" rel="noreferrer" data-copy="footerLicense">${copy.footerLicense}</a>
        </nav>
      </div>
      <div class="site-footer__base">
        <span>© 2026 mxrsv</span>
        <span class="site-footer__built" data-copy="footerBuilt">${copy.footerBuilt}</span>
      </div>
    </footer>
  `;
}

export function renderTour(copy) {
  return {
    markup: `
      <section class="tour">
        ${SHOW_DEMO_LOOP ? renderDemoLoop(copy) : ""}
        ${renderChapters(copy, { featuresId: FEATURES_ID })}
        ${renderFinale(copy)}
        ${renderFooter(copy)}
      </section>
    `,
    mount(root) {
      const section = root.querySelector(".tour");

      if (!section) {
        throw new Error("Tour root is missing.");
      }

      mountFinale(section);

      const disposeReveal = mountReveal(section);
      const disposeDemoLoop = SHOW_DEMO_LOOP ? mountDemoLoop(section) : () => {};

      return () => {
        disposeDemoLoop();
        disposeReveal();
      };
    },
  };
}

/**
 * Swap localized tour copy in place (same reasoning as the hero: keep the DOM
 * and scroll state alive across a locale toggle).
 *
 * @param {Element} root
 * @param {Record<string, string>} copy
 */
export function updateTourLocale(root, copy) {
  const section = root.querySelector(".tour");

  if (!section) {
    throw new Error("Tour root is missing.");
  }

  for (const node of section.querySelectorAll("[data-copy]")) {
    const text = copy[node.dataset.copy];

    if (typeof text === "string") {
      node.textContent = text;
    }
  }
}

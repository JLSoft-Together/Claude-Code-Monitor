import "../styles/tokens.css";
import "../styles/appwin.css";
import "../styles/appwin-tree.css";
import "../styles/frame.css";
import "../styles/direction-a.css";
import "../styles/tour.css";
import "../styles/demo-loop.css";
import "../styles/release-modal.css";
import "../styles/hero-copy-column.css";
import "../styles/hero.css";
import "../styles/stat-band.css";
import "../styles/widgets.css";
import "../styles/widgets-launch.css";
import "../styles/widgets-keep.css";
import "../styles/layout-chapters.css";
import "../styles/finale.css";

import { messages } from "./copy.js";
import { upgradeReleaseLinks } from "./download-links.js";
import { renderHero } from "./hero.js";
import { mountQuickInstall } from "./install-command.js";
import { announceRelease, isReleaseModalForced } from "./release-modal.js";
import { safeLocalStorage } from "./safe-storage.js";
import { renderTour } from "./tour/index.js";

const specimenRoot = document.querySelector("#specimen-root");

if (!specimenRoot) {
  throw new Error("Landing page root is missing.");
}

let disposePage = () => {};

function render() {
  disposePage();

  const page = renderHero(messages.en);
  const tour = renderTour(messages.en);
  specimenRoot.innerHTML = page.markup + tour.markup;
  const disposeRenderer = page.mount(specimenRoot);
  const disposeInstall = mountQuickInstall(specimenRoot);
  const disposeTour = tour.mount(specimenRoot);
  disposePage = () => {
    disposeTour();
    disposeInstall();
    disposeRenderer();
  };

  document.documentElement.lang = "en";
}

render();

// One-shot: the public landing is English-only. The release notice rides this
// same request — see release-modal.js — so the page makes one GitHub call.
void upgradeReleaseLinks(specimenRoot).then((releases) => {
  announceRelease(document.body, messages.en, releases, {
    storage: safeLocalStorage(),
    forced: isReleaseModalForced(globalThis.location?.search),
  });
});

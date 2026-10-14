/**
 * The hero's one focal loop (2026-10-10).
 *
 * An agent row in the rail turns `asked`, waits for you and is answered — the
 * product's promise acted out in the marks the real rail already carries. It
 * replaces the six-scene slideshow: every change here has a cause a reader can
 * name. The project's `N need you` and the strip's needs-you chip are counted
 * off the same rows after every paint, so the three never disagree, as in the
 * app (`buildAttentionList` walks the rail's own panes).
 *
 * Budget (motion review, 2026-10-10): at most one working + one asked row per
 * beat, nothing outside the window loops, and every loop pauses off screen and
 * in a hidden tab, and never starts under reduced motion. There is no on-page
 * Pause control (owner, 2026-10-13, decided twice after being told it is what
 * WCAG 2.2.2 asks of a loop that runs past five seconds).
 */

const FADE_OUT = { duration: 120, easing: "cubic-bezier(0.3, 0, 0.8, 0.15)" };
const FADE_IN = { duration: 200, easing: "cubic-bezier(0.05, 0.7, 0.1, 1)" };
const ANSWERED_MS = 700;
const VISIBLE_RATIO = 0.35;
const NEEDS_YOU = '.a-tree__dot:is([data-state="asked"], [data-state="failed"])';
const FAILED = '.a-tree__dot[data-state="failed"]';

/**
 * Recount every `[data-need-scope]` project — its hidden rows (`data-need-base`)
 * plus the visible rows that need you — and the strip's chip from the sum.
 * A count of zero hides its element, as the app draws no empty count.
 *
 * @param {ParentNode} root
 */
function syncNeeds(root) {
  let total = 0;
  let failed = false;

  for (const scope of root.querySelectorAll("[data-need-scope]")) {
    const count = Number(scope.dataset.needBase ?? 0) + scope.querySelectorAll(NEEDS_YOU).length;
    const label = scope.querySelector("[data-need-count]");
    const scopeFailed = scope.querySelector(FAILED) !== null;

    total += count;
    failed ||= scopeFailed;

    if (label) {
      label.textContent = `${count} need you`;
      label.hidden = count === 0;
      setFailedTone(label, scopeFailed);
    }
  }

  for (const chip of root.querySelectorAll("[data-need-total]")) {
    const value = chip.querySelector("[data-need-total-count]");

    if (value) {
      value.textContent = String(total);
    }

    chip.hidden = total === 0;
    setFailedTone(chip, failed);
  }
}

/** Red once anything counted has failed, the app's yellow otherwise. */
function setFailedTone(el, failed) {
  if (failed) {
    el.dataset.tone = "failed";
  } else {
    delete el.dataset.tone;
  }
}

function swapText(el, text, animate) {
  if (el.textContent === text) {
    return;
  }

  if (!animate || typeof el.animate !== "function") {
    el.textContent = text;
    return;
  }

  el.animate([{ opacity: 1 }, { opacity: 0 }], FADE_OUT).finished.then(
    () => {
      el.textContent = text;
      el.animate([{ opacity: 0 }, { opacity: 1 }], FADE_IN);
    },
    () => {
      el.textContent = text;
    },
  );
}

/**
 * Paint one beat. `rows` is keyed by pane id — the `[data-dot]` /
 * `[data-tail]` hooks the stage renderer already emits — so no shared
 * renderer learns about the loop.
 */
function paintBeat(root, beat, animate) {
  for (const [id, patch] of Object.entries(beat.rows)) {
    for (const dot of root.querySelectorAll(`[data-dot="${id}"]`)) {
      const answered =
        dot.dataset.state === "asked" && patch.state !== undefined && patch.state !== "asked";

      if (patch.state) {
        dot.dataset.state = patch.state;
      }

      const row = dot.closest(".a-tree__row");

      if (answered && animate && row) {
        row.classList.add("is-answered");
        setTimeout(() => row.classList.remove("is-answered"), ANSWERED_MS);
      }
    }

    if (patch.tail !== undefined) {
      for (const tail of root.querySelectorAll(`[data-tail="${id}"]`)) {
        swapText(tail, patch.tail, animate);
      }
    }
  }

  syncNeeds(root);
}

/**
 * @param {ParentNode} root where the rail hooks live
 * @param {Array<{ hold: number, rows: Record<string, { state?: string, tail?: string }> }>} beats
 * @param {{ stillBeat?: number }} [options] the frame a reader who asked for
 *   no motion is left on — the asking one, because that frame is the message
 * @returns {{ play(): void, pause(): void, repaint(): void, dispose(): void }}
 *   `repaint` restores the current beat after something else wrote the same
 *   hooks (a stream remount paints its completed frame over every row).
 */
export function mountAskedBeat(root, beats, { stillBeat = 0 } = {}) {
  if (beats.length === 0) {
    throw new Error("The asked beat needs at least one beat.");
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let index = reduceMotion ? stillBeat : 0;
  let timer = null;
  let dueAt = 0;
  let remaining = beats[index].hold;
  let running = false;

  // Earlier beats may have set fields the current one leaves alone, so a
  // still paint walks every beat up to it, exactly as the loop would have.
  function repaint() {
    for (let i = 0; i <= index; i += 1) {
      paintBeat(root, beats[i], false);
    }
  }

  repaint();

  function schedule(ms) {
    dueAt = performance.now() + ms;
    timer = setTimeout(advance, ms);
  }

  function advance() {
    index = (index + 1) % beats.length;
    paintBeat(root, beats[index], true);
    schedule(beats[index].hold);
  }

  return {
    play() {
      if (running || reduceMotion) {
        return;
      }

      running = true;
      schedule(remaining);
    },
    pause() {
      if (!running) {
        return;
      }

      running = false;
      clearTimeout(timer);
      remaining = Math.max(0, dueAt - performance.now());
    },
    repaint,
    dispose() {
      running = false;
      clearTimeout(timer);
    },
  };
}

/**
 * One switch for everything that moves on its own: reduced motion, the
 * product scrolled under {@link VISIBLE_RATIO} on screen, or a hidden tab each
 * turn it off. `section.dataset.motion` mirrors the state so CSS can hold its
 * own loops (spinner, ripple) in the same breath.
 *
 * @param {HTMLElement} section
 * @param {{ watch: Element, onPlay: () => void, onPause: () => void }} options
 * @returns {() => void} dispose
 */
export function mountMotionGate(section, { watch, onPlay, onPause }) {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let onScreen = true;
  let active = false;

  function sync() {
    const next = !reduceMotion && onScreen && document.visibilityState !== "hidden";

    section.dataset.motion = next ? "on" : "off";

    if (next === active) {
      return;
    }

    active = next;
    (next ? onPlay : onPause)();
  }

  const observer =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(
          (entries) => {
            const entry = entries.at(-1);

            // `isIntersecting` is true for any overlap whatever the threshold,
            // so the ratio is what decides "on screen".
            onScreen = entry ? entry.intersectionRatio >= VISIBLE_RATIO : true;
            sync();
          },
          { threshold: [0, VISIBLE_RATIO] },
        );

  observer?.observe(watch);
  document.addEventListener("visibilitychange", sync);
  sync();

  return () => {
    observer?.disconnect();
    document.removeEventListener("visibilitychange", sync);
    onPause();
  };
}

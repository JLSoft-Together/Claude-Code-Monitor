/**
 * Line icons for the feedback page, drawn on one 24px grid with round caps so
 * they read as a set. Static markup only — never interpolate user text here.
 */

function icon(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

export const CATEGORY_ICONS = {
  bug: icon(
    '<path d="M8 10a4 4 0 0 1 8 0v4a4 4 0 0 1-8 0z"/><path d="M12 10v8M4 13h4M16 13h4M5.5 8.5 8 10M18.5 8.5 16 10M5.5 18.5 8 17M18.5 18.5 16 17M9.5 6.5 8 5M14.5 6.5 16 5"/>',
  ),
  idea: icon(
    '<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z"/>',
  ),
  other: icon('<path d="M20 12a8 8 0 0 1-11.7 7.1L4 20l1-4.1A8 8 0 1 1 20 12z"/>'),
};

export const STATUS_ICONS = {
  pending: icon('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/>'),
  review: icon(
    '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.5"/>',
  ),
  done: icon('<path d="M5 12.5 9.5 17 19 7.5"/>'),
};

export const SEND_ICON = icon('<path d="M5 12h14M13 6l6 6-6 6"/>');

/** The sent state's check: a ring, then the tick, each drawn by CSS. */
export const SENT_ICON = `
  <svg class="feedback-sent__check" viewBox="0 0 52 52" aria-hidden="true">
    <circle cx="26" cy="26" r="24" fill="none" stroke="currentColor" stroke-width="2.5" />
    <path d="M15 27l7 7 15-16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
`;

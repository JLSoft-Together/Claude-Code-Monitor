// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { messages } from "./copy.js";
import { renderFeedbackShell } from "./feedback-view.js";
import { renderBoard } from "./feedback-board-view.js";
import { setComposerState } from "./feedback-form-view.js";
import { createFeedbackAuth } from "./feedback-auth.js";

function shell() {
  const root = document.createElement("div");
  document.body.append(root);
  renderFeedbackShell(root, messages.en, "en");
  return root;
}
afterEach(() => {
  document.body.replaceChildren();
  delete globalThis.google;
});

describe("feedback views", () => {
  it("renders submitted title and description as inert text, including line breaks", () => {
    const root = shell();
    const report = {
      id: "id",
      title: '<img src=x onerror="alert(1)">',
      description: "<script>bad()</script>\nSecond line",
      category: "bug",
      status: "pending",
      updatedAt: new Date().toISOString(),
    };
    renderBoard(root, { pending: [report], review: [], done: [] }, messages.en, "en");
    const card = root.querySelector(".feedback-card");
    expect(card.querySelector("img, script")).toBeNull();
    expect(card.querySelector(".feedback-card__description").textContent).toBe(report.description);
  });
  it("keeps submit disabled before sign-in and locks every draft field while sending", () => {
    const root = shell();
    setComposerState(root, "idle", null, messages.en);
    expect(root.querySelector(".feedback-submit").disabled).toBe(true);
    root.dataset.authReady = "true";
    setComposerState(root, "sending", null, messages.en);
    expect(root.querySelector('[name="title"]').readOnly).toBe(true);
    expect(root.querySelector('[name="category"]').disabled).toBe(true);
    setComposerState(root, "error", "feedbackErrorServer", messages.en);
    expect(root.querySelector('[name="category"]').disabled).toBe(false);
    expect(root.querySelector(".feedback-submit").disabled).toBe(false);
  });
  it("keeps Google credentials in memory, clears them on sign-out and leaves the draft alone", async () => {
    const root = shell();
    let callback;
    globalThis.google = {
      accounts: {
        id: {
          initialize: (options) => {
            callback = options.callback;
          },
          renderButton: () => {},
          disableAutoSelect: () => {},
        },
      },
    };
    root.querySelector('[name="title"]').value = "My draft";
    const states = [];
    const auth = createFeedbackAuth(root, "client-id", (ready) => states.push(ready));
    await Promise.resolve();
    callback({ credential: "private-token" });
    expect(auth.token()).toBe("private-token");
    expect(root.innerHTML).not.toContain("private-token");
    root.querySelector("[data-auth-signout]").click();
    expect(auth.token()).toBeNull();
    expect(states.at(-1)).toBe(false);
    expect(root.querySelector('[name="title"]').value).toBe("My draft");
  });
});

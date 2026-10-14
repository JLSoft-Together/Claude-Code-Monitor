import { describe, expect, it } from "vitest";

import { FEEDBACK_DRAFT_KEY, clearDraft, readDraft, writeDraft } from "./feedback-draft.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    has: (key) => values.has(key),
  };
}

const refusing = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("quota");
  },
  removeItem() {
    throw new Error("blocked");
  },
};

describe("feedback draft", () => {
  it("round-trips a draft and drops it once both fields are empty", () => {
    const storage = memoryStorage();
    const now = new Date("2026-09-14T10:00:00.000Z");

    const id = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

    expect(
      writeDraft(storage, { title: "Pin agents", body: "", category: "idea", id }, now),
    ).toBe("saved");
    expect(readDraft(storage)).toEqual({
      title: "Pin agents",
      body: "",
      category: "idea",
      id,
      savedAt: "2026-09-14T10:00:00.000Z",
    });

    expect(writeDraft(storage, { title: " ", body: "", category: "idea" })).toBe("empty");
    expect(storage.has(FEEDBACK_DRAFT_KEY)).toBe(false);
  });

  it("reads a pre-id draft or a malformed id back without one", () => {
    for (const id of [undefined, "not-a-uuid"]) {
      const draft = readDraft(
        memoryStorage({ [FEEDBACK_DRAFT_KEY]: JSON.stringify({ title: "x", body: "", id }) }),
      );
      expect(draft?.id).toBe("");
    }
  });

  it("ignores corrupt or foreign values and repairs an unknown category", () => {
    expect(readDraft(memoryStorage({ [FEEDBACK_DRAFT_KEY]: "{not json" }))).toBeNull();
    expect(readDraft(memoryStorage({ [FEEDBACK_DRAFT_KEY]: '{"title":1}' }))).toBeNull();

    const draft = readDraft(
      memoryStorage({
        [FEEDBACK_DRAFT_KEY]: JSON.stringify({ title: "x", body: "y", category: "spam" }),
      }),
    );
    expect(draft?.category).toBe("bug");
  });

  it("reports a refusing or missing storage instead of throwing", () => {
    expect(readDraft(refusing)).toBeNull();
    expect(writeDraft(refusing, { title: "Pin", body: "", category: "bug" })).toBe("refused");
    expect(writeDraft(null, { title: "Pin", body: "", category: "bug" })).toBe("refused");
    expect(clearDraft(refusing)).toBe(false);
    expect(clearDraft(memoryStorage())).toBe(true);
  });
});

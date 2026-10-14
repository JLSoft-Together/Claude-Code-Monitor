/**
 * `localStorage`, or null where the browser refuses it. Reading the property
 * itself throws in a blocked third-party context, so the guard has to wrap the
 * property access, not just the later get/set.
 */
export function safeLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

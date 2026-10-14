const GOOGLE_SCRIPT = "https://accounts.google.com/gsi/client";
const LOAD_TIMEOUT_MS = 12_000;
let loading;

function loadGoogle() {
  if (globalThis.google?.accounts?.id) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      loading = undefined;
      reject(new Error("Google sign-in could not load"));
    };
    const timer = setTimeout(fail, LOAD_TIMEOUT_MS);
    script.src = GOOGLE_SCRIPT;
    script.async = true;
    script.onload = () => {
      clearTimeout(timer);
      if (globalThis.google?.accounts?.id) resolve();
      else fail();
    };
    script.onerror = fail;
    document.head.append(script);
  });
  return loading;
}

/** Tokens live only in memory and are verified by the Worker on every submit. */
export function createFeedbackAuth(root, clientId, changed) {
  let credential = null;
  const container = root.querySelector("[data-google-signin]");
  const status = root.querySelector("[data-auth-status]");
  const signout = root.querySelector("[data-auth-signout]");
  const retry = root.querySelector("[data-auth-retry]");
  const section = root.querySelector("[data-feedback-auth]");
  section.hidden = false;
  const update = (message) => {
    status.textContent = message;
    container.hidden = Boolean(credential);
    signout.hidden = !credential;
    changed(Boolean(credential));
  };
  const reset = () => {
    credential = null;
    globalThis.google?.accounts?.id.disableAutoSelect();
    update("Sign in with Google to send feedback and receive email updates.");
  };
  async function start() {
    retry.hidden = true;
    update("Loading Google sign-in…");
    try {
      await loadGoogle();
      google.accounts.id.initialize({
        client_id: clientId,
        auto_select: false,
        callback: (response) => {
          if (typeof response.credential !== "string" || !response.credential) {
            reset();
            return;
          }
          credential = response.credential;
          update("Signed in with Google. Your email stays private.");
        },
      });
      google.accounts.id.renderButton(container, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "signin_with",
        shape: "pill",
      });
      reset();
    } catch {
      update("Google sign-in is unavailable. Your draft is still here.");
      retry.hidden = false;
    }
  }
  signout.addEventListener("click", reset);
  retry.addEventListener("click", () => void start());
  void start();
  return { token: () => credential, reset };
}

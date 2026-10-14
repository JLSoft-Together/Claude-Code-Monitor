// Give macOS a real dev bundle: app.setName() cannot change the Dock label.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronBin from "electron";

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = path.dirname(path.dirname(SCRIPT));
const DEV_NAME = "Deck Dev";
const DEV_BUNDLE_ID = "dev.spacevibe.deck.dev";

export function prepareDevElectron() {
  if (process.platform !== "darwin") return electronBin;

  const source = path.resolve(electronBin, "..", "..", "..");
  const icon = path.join(ROOT, "build", "icon.icns");
  const sourcePlist = path.join(source, "Contents", "Info.plist");
  // A versioned cache avoids overwriting a runtime another dev process is using.
  const fingerprint = createHash("sha256")
    .update(readFileSync(SCRIPT))
    .update(readFileSync(sourcePlist))
    .update(readFileSync(icon))
    .update(`${electronBin}:${statSync(electronBin).mtimeMs}`)
    .digest("hex")
    .slice(0, 20);
  const cache = path.join(ROOT, "node_modules", ".cache", "deck-dev");
  const destination = path.join(cache, fingerprint);
  const bundle = path.join(destination, `${DEV_NAME}.app`);
  // Keep the executable named Electron so app.isPackaged remains false.
  const executable = path.join(bundle, "Contents", "MacOS", path.basename(electronBin));
  if (existsSync(executable)) return executable;

  mkdirSync(cache, { recursive: true });
  const staging = mkdtempSync(path.join(cache, "preparing-"));
  const stagedBundle = path.join(staging, `${DEV_NAME}.app`);
  try {
    cpSync(source, stagedBundle, {
      recursive: true,
      mode: constants.COPYFILE_FICLONE,
      verbatimSymlinks: true,
    });
    const plist = path.join(stagedBundle, "Contents", "Info.plist");
    // Preserve CFBundleName: Electron uses it for its default userData path.
    // The bundle filename and display name provide the native Dock identity.
    for (const [key, value] of [
      ["CFBundleDisplayName", DEV_NAME],
      ["CFBundleIdentifier", DEV_BUNDLE_ID],
      ["CFBundleIconFile", "deck-dev.icns"],
    ]) {
      execFileSync("/usr/bin/plutil", ["-replace", key, "-string", value, plist]);
    }
    copyFileSync(icon, path.join(stagedBundle, "Contents", "Resources", "deck-dev.icns"));
    // Downloaded dev runtimes may have unsealed nested resources. Ad-hoc sign
    // the local copy, including helpers, without requiring a signing identity.
    execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", stagedBundle], {
      stdio: "pipe",
    });
    execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", stagedBundle]);
    try {
      renameSync(staging, destination);
    } catch (error) {
      // A concurrent launcher may have atomically published the same runtime first.
      if (!(["EEXIST", "ENOTEMPTY"].includes(error.code) && existsSync(executable))) {
        throw error;
      }
    }
    return executable;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function launch() {
  const child = spawn(
    prepareDevElectron(),
    ["dist-electron/electron/main.cjs", ...process.argv.slice(2)],
    { cwd: ROOT, stdio: "inherit" },
  );
  const forward = (signal) => child.kill(signal);
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  child.once("error", (error) => {
    console.error("Deck Dev could not launch:", error);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) launch();

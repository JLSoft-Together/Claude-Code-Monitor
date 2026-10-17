# v58 — GitHub accounts (multi-account, token based)

## Why
A push from the Git Log dialog failed with `remote: Repository not found.`: Git Credential Manager only held one
GitHub account, which had no access to the org repo. Owner asked (2026-10-17) for Android Studio style multiple
GitHub accounts, added by pasting a personal access token.

## Shape
- Settings → GitHub accounts (`GitHubAccountsSettings.vue`): list (login, name, scopes, Default), Make default,
  Remove (native confirm in main), add form (password field → `ccm:gh-account-add`), "Generate a token on GitHub…"
  opens `GH_TOKEN_URL` (classic, `repo,workflow,read:org`).
- Push dialog: "Account" picker for an https github.com remote when at least one account exists — Automatic (the
  account auto resolves to) / each account / Git Credential Manager; the pick is remembered per repo. Notes when the
  account cannot reach or only read the repo; after an `auth` failure a hint links to Settings.
- Fetch / Update (pull, ff fetch) / remote branch delete use the repo's account without UI.

## Invariants
- The token goes from page to main once (add) and never back; `GhAccount` has no token field. On disk it is
  `safeStorage` ciphertext (`github-accounts.json` in the data dir, mode 600). No keychain → refuse to add.
- Git gets the token only through env config (`GIT_CONFIG_COUNT` / `KEY_n` / `VALUE_n`, git ≥ 2.31), never argv:
  `http.https://github.com/.extraHeader = Authorization: Basic base64(x-access-token:<token>)` plus an empty
  `credential.https://github.com.helper`, which clears GCM for github.com only, so a refused token fails with
  `could not read Username` (→ `auth`) instead of a GCM window or another stored account. Other hosts untouched.
- Resolution (`GitHubAccounts.resolve`): pinned account → that one; `system` → no token; `auto` → probe
  `GET /repos/{owner}/{repo}` with every account (cached 10 min), push beats read, default first; nobody has access →
  no token (GCM as before); every probe offline → default account.
- SSH remotes and non-GitHub hosts: no account, nothing changes.
- API calls go only to `api.github.com`, only on add and when a push dialog / network git command needs a repo's
  account (owner-triggered); no polling.

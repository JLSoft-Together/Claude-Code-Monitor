---
name: landing-sync
description: Report which parts of the Deck landing page (marketing/landing-prototype, marketing/stage) are stale against the app (src/, electron/, docs, CHANGELOG). Read-only by default. Use for "landing drift", "sync landing", "is the landing stale", or as the "before release" check before tagging. Takes an optional git range.
argument-hint: "[<base>[..<rev>]]"
---

# landing-sync — does the landing still describe the app?

The landing is hand-copied from the app. A few files import app code; everything else
restates the app in prose, fixtures and comments that cite the app source they mirror.
`.github/workflows/landing.yml` runs only on `marketing/**`, so a change under `src/`,
`electron/` or `docs/` never fails a landing check. This skill is that check, run by hand.

**Read-only by default.** Produce the report, stop, and wait for the owner. Do not edit
anything under `marketing/` in the same pass — see "After the report".

Shell state does not survive between tool calls, so step 0 writes the three values every
later block needs to `/tmp/landing-sync.env`, and every block opens by sourcing it. Never
retype a hash from memory; re-source the file.

## 0. Pick the revision

Arguments: `$ARGUMENTS`. Empty → judge `origin/main` from the last commit that touched the
landing. `<base>` → that base, still judging `origin/main`. `<base>..<rev>` → both given.
The production landing deploys from `origin/main`; the primary checkout can be far ahead of
it and dirty, so the judged revision is checked out into a scratch worktree and nothing
below reads the checkout you were started in.

```bash
REV=origin/main                                   # or the <rev> half of the argument
git fetch origin --quiet
W=/tmp/landing-sync-$(git rev-parse --short "$REV")
[ -d "$W" ] || git worktree add --detach --quiet "$W" "$REV"
cd "$W"
BASE=$(git log -1 --format=%H -- marketing/landing-prototype marketing/stage)   # or the <base> argument
printf 'REV=%s\nW=%s\nBASE=%s\n' "$(git rev-parse HEAD)" "$W" "$BASE" > /tmp/landing-sync.env
cat /tmp/landing-sync.env; git log -1 --format='%h %ad %s' --date=short "$BASE"
```

A landing commit resets the baseline only for what it touched. Drift older than the base is
caught by the state passes in step 3 (c, d, e), which do not depend on the range, so run
them every time.

## 1. What changed in the app since the base

```bash
. /tmp/landing-sync.env && cd "$W"
git diff --name-only "$BASE"..HEAD -- src electron docs/user docs/internals CHANGELOG.md
git diff "$BASE"..HEAD -- CHANGELOG.md | grep -E '^\+' | grep -iE '^\+## |retired|removed|replaced|no longer|renamed'
```

Read every new `## <version>` section in full, not only the grep hits: a surface the landing
sells can be rewritten without any of those words.

## 2. Derive the coupling map

Do not keep a hand-written table of what the landing mirrors. Derive it from the landing each
run, in five passes. Each block starts from the scratch worktree.

**a. Imports.** The only live links; an app change here breaks the landing build or changes
its pixels.

```bash
. /tmp/landing-sync.env && cd "$W"
grep -rnE "from ['\"][^'\"]*\.\./src/|new URL\(['\"][^'\"]*\.\./src/" marketing/landing-prototype marketing/stage --include='*.js' --include='*.mjs' --include='*.html' --exclude-dir=node_modules
```

**b. Path citations.** Comments naming the app file they copy. Classify each path: present at
the repo root → coupling; present only under `marketing/` → landing-internal, skip; present
nowhere → the source moved or died, so the copy is unverifiable and goes to **Probably stale**
until the fixture is checked by hand.

```bash
. /tmp/landing-sync.env && cd "$W"
grep -rnoE "(src|electron|docs)/[A-Za-z0-9_./-]+\.(ts|tsx|js|css|md|rs)" marketing/landing-prototype marketing/stage --include='*.js' --include='*.css' --include='*.html' --include='*.mjs' --exclude-dir=node_modules | sort -u
```

Cross each coupling path with step 1: a cited file in the diff → **Probably stale**, read the
diff and the mirror together to promote or clear it.

**c. Copy.** `marketing/landing-prototype/src/copy.js` carries the panel text in every
locale, so one wrong sentence appears once per locale.

```bash
. /tmp/landing-sync.env && cd "$W"
# Chords the landing promises. Each must map, in docs/user/keyboard-shortcuts.md,
# to the feature the sentence around it names.
grep -noE "⌘[⇧⌥⌃]*[A-Z0-9]" marketing/landing-prototype/src/copy.js | sort -t: -k2 -u
# Feature names come from the docs, not from a list kept here: page titles and
# shortcut actions. Grep the landing for each name that is a product noun.
{ sed -nE 's/^# (.+)$/\1/p' docs/internals/*.md docs/user/*.md
  grep -hoE '^\| [A-Z][^|]+' docs/user/keyboard-shortcuts.md | sed 's/^| //;s/ *$//'; } | sort -u
```

**d. Version pins.** Comments and fixtures that say which Deck they draw.

```bash
. /tmp/landing-sync.env && cd "$W"
grep -rnoE "Deck [0-9]+\.[0-9]+(\.[0-9]+)?" marketing/landing-prototype marketing/stage --include='*.js' --include='*.css' --exclude='*.test.js' --exclude-dir=node_modules | sort -u
node -p "require('./package.json').version"
```

A pin older than the current version is not drift by itself. It is drift when the surface it
names changed since that version: check it against the CHANGELOG sections in between.

**e. Retired subjects.** The docs date every retirement. A page-level "is this page retired?"
question misses a surface retired in the middle of a living page, so the unit here is the
retirement line, not the page.

```bash
. /tmp/landing-sync.env && cd "$W"
grep -niE "(retired|removed|replaced|superseded)[^.]{0,40}([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]+\.[0-9]+\.[0-9]+)" docs/internals/*.md docs/user/*.md
```

For every line, take the thing it retires — the noun phrase before the verb, plus the
chord or control that went with it — and grep the landing for it and its plain variants.
The subjects are read off the lines each run; today's lines give, for example:

```bash
. /tmp/landing-sync.env && cd "$W"
grep -rniE "agent board|⌘⇧O|checkout card|checkout is a card|fold(s|ed)? (its|the) agents|card.{0,20}\+" marketing/landing-prototype/src marketing/stage --include='*.js' --exclude='*.test.js'
```

Every hit is **Stale**: the landing sells something the app no longer has. Map a hit to its
panel through `PANELS` in `marketing/landing-prototype/src/tour/index.js` and the copy key
it uses, and the fix covers the scene and the key in every locale.

Also grep the landing for the stem of every app file in the step 1 diff (`agent-rail`,
`tab-manager`, …). A hit is a mirror without a citation; treat it as a citation.

## 3. Report

One entry per landing surface, keyed `file:line`. Group as **Stale** (the app contradicts it),
**Probably stale** (its source changed, moved or died and the mirror has not been re-read),
**OK** (checked, still true). Each Stale or Probably stale entry carries:

- **App change:** what happened, with the commit, CHANGELOG section or docs line.
- **Evidence:** the landing line and the app line, both quoted.
- **Wrong now:** what a reader is told that is no longer true.
- **Fix:** the replacement copy, fixture or deletion. Tour panels come in pairs: the scene
  under `marketing/landing-prototype/src/tour/scenes/` and its text in `copy.js`, in every
  locale.

End the report with `REV` and `BASE` from `/tmp/landing-sync.env` and which of the five
passes ran. An empty **Stale** group is a finding only if every pass ran. Then clean up:

```bash
. /tmp/landing-sync.env && git worktree remove --force "$W" && rm /tmp/landing-sync.env
```

## After the report

Landing edits start only after the owner approves the report, and follow the landing's own
workflow: a worktree, a `feat(landing)` or `fix(landing)` commit per surface, the
`landing.yml` tests and `npm run build:landing`, and the owner's eye review of the rendered
page before merge. The landing stays free of tests that pin app data (owner decision, DECK-85);
this skill is the check that replaced them, so do not turn its passes into CI.

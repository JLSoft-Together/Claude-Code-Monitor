import { defineConfig } from 'vitest/config'

// Tests that spawn real git / node / file trees: under a full parallel run on Windows each
// process start can take seconds, so the default 5 s per test is a timing gamble, not a check.
const PROCESS_HEAVY = [
  'blame',
  'branches',
  'branches-push',
  'build-clean',
  'changes',
  'checkpoints',
  'claude-hooks',
  'commit',
  'commonDir',
  'git-image',
  'github-accounts',
  'layout-model-service',
  'log',
  'overlap',
  'preview-ipc',
  'run-hardening',
  'search',
  'worktrees',
].map((name) => `test/${name}.test.ts`)

export default defineConfig({
  test: {
    projects: [
      { extends: true, test: { name: 'unit', include: ['test/**/*.test.ts'], exclude: PROCESS_HEAVY } },
      { extends: true, test: { name: 'process', include: PROCESS_HEAVY, testTimeout: 30_000, hookTimeout: 60_000 } },
    ],
  },
})

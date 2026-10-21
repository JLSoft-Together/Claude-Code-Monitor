import { defineConfig } from 'vitest/config';

// Upstream runs every test in node (the client tests install a minimal `window` themselves). A test that needs a real DOM
// opts in with `// @vitest-environment happy-dom` in its first lines.
export default defineConfig({
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'client/src/**/*.test.ts'],
    environment: 'node',
  },
});

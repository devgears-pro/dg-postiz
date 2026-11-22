import { configDefaults, defineConfig } from 'vitest/config';

const integrationTests = '**/*.integration.spec.ts';
const runIntegrationTests = process.env.POSTIZ_RUN_DB_TESTS === '1';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: runIntegrationTests ? [integrationTests] : configDefaults.include,
    exclude: runIntegrationTests
      ? configDefaults.exclude
      : [...configDefaults.exclude, integrationTests],
  },
});

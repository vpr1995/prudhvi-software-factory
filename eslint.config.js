// Root ESLint config. Gate file. Used by lint-staged and editors; each Rush project also has its own
// eslint.config.js that composes the same shared configs for `rush lint`.
// Import is relative because the repo root has no node_modules (Rush installs per project).
import { createRootConfig } from './tooling/eslint-config/src/index.js';

export default createRootConfig({
  rootPath: import.meta.dirname,
  // Rush output and tool-owned config files are not application code.
  ignores: ['common/**', '.dependency-cruiser.cjs', '.lintstagedrc.cjs', 'commitlint.config.cjs'],
});

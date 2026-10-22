// Gate file. Used by `rush prettier` (scripts/git/lint-staged.sh) and the pre-commit hook.
// ESLint runs from the repo root with the root eslint.config.js, which picks the right config per path.
// The eslint binary comes from @vprprudhvi/tooling-eslint-config (installed by `rush install`).
const path = require('node:path');

const eslintBin = path.join(
  __dirname,
  'tooling',
  'eslint-config',
  'node_modules',
  '.bin',
  'eslint',
);
const quote = (files) => files.map((file) => `"${file}"`).join(' ');

module.exports = {
  '*.{ts,tsx,js,jsx,mjs,cjs}': (files) => [
    `prettier --write ${quote(files)}`,
    `"${eslintBin}" --max-warnings 0 --no-warn-ignored ${quote(files)}`,
  ],
  '*.{json,jsonc,yml,yaml,css}': (files) => [`prettier --write ${quote(files)}`],
};

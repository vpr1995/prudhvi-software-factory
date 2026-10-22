// Gate file. Conventional Commits. Run by `rush commitlint --message-file <file>`.
// @commitlint/config-conventional lives in the rush-commitlint autoinstaller, not in a root node_modules.
const path = require('node:path');

const autoinstallerModules = path.join(
  __dirname,
  'common',
  'autoinstallers',
  'rush-commitlint',
  'node_modules',
);

module.exports = {
  extends: [require.resolve('@commitlint/config-conventional', { paths: [autoinstallerModules] })],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'refactor', 'test', 'chore', 'ci', 'build', 'perf', 'revert'],
    ],
    // Scopes are free for now. Add scope-enum (Rush project names) when the project list is stable.
    'scope-enum': [0],
    'header-max-length': [2, 'always', 100],
  },
};

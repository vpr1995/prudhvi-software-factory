// Tests for scripts/doc-lint.mjs: scan policy, links, inline code paths and Rush commands.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  checkDocument,
  formatFinding,
  frontMatterStatus,
  ignoreQueries,
  isExcluded,
  knownPaths,
  rushCommands,
  scanPolicy,
} from '../scripts/doc-lint.mjs';

const COMMAND_LINE = `{
  // Custom commands.
  "commands": [
    { "commandKind": "bulk", "name": "verify", /* inline */ "summary": "a // b" },
    { "commandKind": "global", "name": "knip", "shellCommand": "x", },
  ],
  "phases": [{ "name": "_phase:build" }],
}`;

const context = {
  known: knownPaths([
    'README.md',
    'docs/guides/api.md',
    'docs/guides/web.md',
    'scripts/security/audit.sh',
    'projects/sample/README.md',
    'projects/sample/scripts/phase.mjs',
  ]),
  commands: rushCommands(COMMAND_LINE),
};

const messages = (file, text) =>
  checkDocument(file, text, context).map((f) => `${f.line}: ${f.message}`);

test('rushCommands reads built-ins and commands of command-line.json, not phases', () => {
  const commands = rushCommands(COMMAND_LINE);
  assert.ok(commands.has('verify'));
  assert.ok(commands.has('knip'));
  assert.ok(commands.has('install'));
  assert.ok(!commands.has('_phase:build'));
});

test('a custom Rush command passes', () => {
  assert.deepEqual(messages('docs/a.md', 'Run `rush verify` and `rush knip`.'), []);
  assert.deepEqual(
    messages('docs/a.md', '```\nnode common/scripts/install-run-rush.js verify --to x\n```'),
    [],
  );
});

test('an unknown Rush command fails, in inline code and in fenced blocks', () => {
  assert.deepEqual(messages('docs/a.md', 'Run `rush deploy-all`.'), [
    '1: unknown Rush command "deploy-all"',
  ]);
  assert.deepEqual(messages('docs/a.md', '```bash\nnode install-run-rush.js frobnicate\n```'), [
    '2: unknown Rush command "frobnicate"',
  ]);
});

test('Rush placeholders, flags, rushx and prose are not commands', () => {
  const text = 'Run `rush <cmd>`, `rush --help`, `rushx dev`, `rush-pnpm x`. Rush builds it.';
  assert.deepEqual(messages('docs/a.md', text), []);
});

test('a broken relative link fails', () => {
  assert.deepEqual(messages('docs/guides/a.md', 'See [web](web.md) and [x](missing.md#top).'), [
    '1: broken link "missing.md#top": docs/guides/missing.md does not exist',
  ]);
});

test('links resolve from the doc folder or from the repo root, to files and folders', () => {
  const text = [
    '[up](../../README.md) [folder](../guides/) [root](/scripts/security/audit.sh)',
    '[ref]: ./api.md "Title"',
  ].join('\n');
  assert.deepEqual(messages('docs/guides/a.md', text), []);
});

test('external, mail and anchor links are skipped', () => {
  const text = '[a](https://x.dev/y) [b](mailto:a@b.c) [c](#section) [d](http://x)';
  assert.deepEqual(messages('docs/a.md', text), []);
});

test('a missing repo path in inline code fails', () => {
  assert.deepEqual(messages('docs/a.md', 'Edit `docs/guides/gone.md`.'), [
    '1: path "docs/guides/gone.md" does not exist',
  ]);
});

test('a trailing :line or :line:col is stripped', () => {
  assert.deepEqual(messages('docs/a.md', '`docs/guides/api.md:42` `docs/guides/web.md:3:7`'), []);
  assert.deepEqual(messages('docs/a.md', '`docs/guides/no.md:42`'), [
    '1: path "docs/guides/no.md:42" does not exist',
  ]);
});

test('spans with placeholders or patterns are skipped', () => {
  const spans = [
    'projects/<name>/src',
    'packages/*/src',
    'docs/{a,b}.md',
    'docs/$NAME.md',
    'docs/.../x.md',
    'rush build --to x',
  ];
  const text = spans.map((span) => `\`${span}\``).join(' ');
  assert.deepEqual(messages('docs/a.md', text), []);
});

test('spans that do not start with a top-level entry are skipped', () => {
  assert.deepEqual(messages('docs/a.md', '`src/api/x.ts` `dist/` `lib/a.ts`'), []);
});

test('a path relative to the doc folder passes', () => {
  assert.deepEqual(messages('projects/sample/README.md', 'Runs `scripts/phase.mjs`.'), []);
  assert.deepEqual(messages('docs/a.md', 'Runs `scripts/phase.mjs`.'), [
    '1: path "scripts/phase.mjs" does not exist',
  ]);
});

test('paths and links in fenced code blocks are skipped', () => {
  const text = '```\ncat docs/missing.md\n[x](missing.md)\n```\n~~~\n`docs/no.md`\n~~~';
  assert.deepEqual(messages('docs/a.md', text), []);
});

test('a link inside inline code is skipped', () => {
  assert.deepEqual(messages('docs/a.md', 'Write `[x](missing.md)`.'), []);
});

test('the ignore marker skips the next line only', () => {
  const text = '<!-- doc-lint-ignore-next-line -->\n`docs/no.md`\n`docs/no2.md`';
  assert.deepEqual(messages('docs/a.md', text), ['3: path "docs/no2.md" does not exist']);
});

test('history and tool folders are excluded', () => {
  assert.ok(isExcluded('docs/adr/0001-x.md'));
  assert.ok(isExcluded('evals/reviewer/cases/2026-01-01-x.md'));
  assert.ok(isExcluded('common/changes/x.md'));
  assert.ok(isExcluded('packages/a/CHANGELOG.md'));
  assert.ok(isExcluded('packages/a/node_modules/b/README.md'));
  assert.ok(!isExcluded('evals/reviewer/README.md'));
  assert.ok(!isExcluded('docs/guides/api.md'));
});

test('frontMatterStatus reads the status of the front matter only', () => {
  assert.equal(frontMatterStatus('---\nstatus: draft\nowner: x\n---\n# T'), 'draft');
  assert.equal(frontMatterStatus("---\nstatus: 'implemented'\n---\n"), 'implemented');
  assert.equal(frontMatterStatus('# T\n\nstatus: draft\n'), '');
  assert.equal(frontMatterStatus('---\nowner: x\n---\n'), '');
});

test('a design is scanned only when its status is implemented', () => {
  const design = 'docs/designs/x/design.md';
  assert.deepEqual(scanPolicy(design, '---\nstatus: draft\n---\n'), { scan: false });
  assert.deepEqual(scanPolicy(design, '---\nstatus: approved\n---\n'), { scan: false });
  assert.deepEqual(scanPolicy(design, '---\nstatus: implemented\n---\n'), { scan: true });
  assert.deepEqual(scanPolicy('docs/guides/a.md', '# A'), { scan: true });
  assert.deepEqual(scanPolicy('docs/adr/0001-a.md', '# A'), { scan: false });
});

test('a design with no status front matter is a finding', () => {
  assert.deepEqual(scanPolicy('docs/designs/x/design.md', '# Design\n'), {
    scan: false,
    finding: 'design has no status front matter',
  });
});

test('formatFinding writes plain lines or GitHub annotations', () => {
  const finding = { file: 'docs/a.md', line: 3, message: '100% wrong\nnext' };
  assert.equal(formatFinding(finding, false), 'docs/a.md:3: 100% wrong\nnext');
  assert.equal(formatFinding(finding, true), '::error file=docs/a.md,line=3::100%25 wrong%0Anext');
});

test('a Rush command after a path prefix is checked, inline and in a fence', () => {
  assert.deepEqual(messages('docs/a.md', '`node common/scripts/install-run-rush.js verfy`'), [
    '1: unknown Rush command "verfy"',
  ]);
  assert.deepEqual(
    messages('docs/a.md', '```\nnode common/scripts/install-run-rush.js verfy\n```'),
    ['2: unknown Rush command "verfy"'],
  );
});

test('footnotes and prose with a colon are not reference links', () => {
  assert.deepEqual(messages('docs/a.md', '[^1]: See the foo docs.\n[Note]: use the flag'), []);
  assert.deepEqual(messages('docs/a.md', '[ref]: <gone.md> "Title"'), [
    '1: broken link "gone.md": docs/gone.md does not exist',
  ]);
});

test('links to the repo root folder pass', () => {
  assert.deepEqual(messages('docs/a.md', '[root](../) [h](/) [r](../docs/../)'), []);
  assert.deepEqual(messages('README.md', '[r](./)'), []);
});

test('ignoreQueries asks for the path and each parent folder with a trailing slash', () => {
  assert.deepEqual(ignoreQueries('platform/infra/cdk.out'), [
    'platform/infra/cdk.out',
    'platform/',
    'platform/infra/',
    'platform/infra/cdk.out/',
  ]);
});

test('a closing fence has no info string, and comment lines in fences are skipped', () => {
  assert.deepEqual(messages('docs/a.md', '```\nx\n```js\n`docs/no.md`\n```'), []);
  assert.deepEqual(messages('docs/a.md', '~~~\n```\n`docs/no.md`\n~~~'), []);
  assert.deepEqual(messages('docs/a.md', '```bash\n# wait for rush to finish\n```'), []);
});

test('a trailing :line-line suffix is stripped', () => {
  assert.deepEqual(messages('docs/a.md', '`docs/guides/api.md:12-20`'), []);
});

test('an empty status does not read the next line, and a BOM is allowed', () => {
  assert.equal(frontMatterStatus('---\nstatus:\nowner: x\n---\n'), '');
  assert.equal(frontMatterStatus('﻿---\nstatus: implemented\n---\n'), 'implemented');
});

test('an unknown design status is a finding', () => {
  assert.deepEqual(scanPolicy('docs/designs/x/design.md', '---\nstatus: wip\n---\n'), {
    scan: false,
    finding: 'design has unknown status "wip". Use draft, approved, implemented or superseded',
  });
});

test('link targets in <...> and with balanced parentheses resolve', () => {
  assert.deepEqual(messages('docs/guides/a.md', '[a](<web.md> "t") [b](<no file.md>)'), [
    '1: broken link "no file.md": docs/guides/no file.md does not exist',
  ]);
  assert.deepEqual(messages('docs/guides/a.md', '[c](foo(1).md)'), [
    '1: broken link "foo(1).md": docs/guides/foo(1).md does not exist',
  ]);
});

test('Rush built-ins from rush --help pass', () => {
  const text =
    '`rush init-deploy` `rush alert` `rush bridge-package` `rush update-cloud-credentials`';
  assert.deepEqual(messages('docs/a.md', text), []);
});

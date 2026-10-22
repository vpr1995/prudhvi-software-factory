import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { exec, GATES, REPOSITORY } from './harness.js';

const HAS_GITLEAKS = exec('sh', ['-c', 'command -v gitleaks']).status === 0;

describe('self scan of the gate sources', () => {
  for (const folder of ['scripts/gates', '.claude/hooks']) {
    it(
      `gitleaks finds nothing in ${folder}`,
      { skip: !HAS_GITLEAKS && 'gitleaks is not installed' },
      () => {
        const result = exec('gitleaks', [
          'dir',
          path.join(REPOSITORY, folder),
          '--no-banner',
          '--redact',
          '--exit-code',
          '1',
          '--config',
          path.join(REPOSITORY, '.gitleaks.toml'),
        ]);
        assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
      },
    );
  }

  it('the built-in secret patterns find nothing in the gate sources', () => {
    const script = `
      import fs from 'node:fs';
      import path from 'node:path';
      import { regexFindings } from ${JSON.stringify(path.join(GATES, 'lib', 'secrets.mjs'))};
      const roots = [${JSON.stringify(GATES)}, ${JSON.stringify(path.join(REPOSITORY, '.claude', 'hooks'))}];
      const stack = [...roots];
      const found = [];
      while (stack.length > 0) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) { stack.push(full); } else {
            found.push(...regexFindings(fs.readFileSync(full, 'utf8'), full));
          }
        }
      }
      process.stdout.write(JSON.stringify(found));
    `;
    const result = exec('node', ['--input-type=module', '-e', script]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), []);
  });

  it('anti-skip passes on the gate sources when its own ignore list is switched off (rule tables excepted)', () => {
    const script = `
      import fs from 'node:fs';
      import path from 'node:path';
      import { addedFile } from ${JSON.stringify(path.join(GATES, 'lib', 'diff-parse.mjs'))};
      import { scanFiles } from ${JSON.stringify(path.join(GATES, 'lib', 'anti-skip-engine.mjs'))};
      const skipTables = new Set(['anti-skip-rules.mjs', 'anti-skip-coverage.mjs', 'anti-skip-engine.mjs', 'bash-rules-tools.mjs']);
      const files = [];
      const stack = [${JSON.stringify(GATES)}];
      while (stack.length > 0) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) { stack.push(full); }
          else if (!skipTables.has(entry.name) && !entry.name.endsWith('.test.js')) {
            files.push(addedFile(path.relative(${JSON.stringify(REPOSITORY)}, full), fs.readFileSync(full, 'utf8')));
          }
        }
      }
      const findings = scanFiles(files, { readFile: () => null, settings: { ignorePaths: [], coverageOnlyPaths: [] } });
      process.stdout.write(JSON.stringify(findings));
    `;
    const result = exec('node', ['--input-type=module', '-e', script]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), []);
  });
});

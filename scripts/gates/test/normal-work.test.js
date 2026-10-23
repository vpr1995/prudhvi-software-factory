// A corpus of normal work. Every command must be ALLOWED by guard-bash, every source edit must
// pass protect-gates and anti-skip, and none of it may look like a gate change to gate-integrity.
// A gate that blocks this corpus gets in the way of real work, so it counts as a bug.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { uncommitted } from '../lib/gate-integrity.mjs';

import { bashCall, callHook, editCall, exec, GATES, makeRepository } from './harness.js';

const CLI = path.join(GATES, 'anti-skip.mjs');
const RUSH = 'node common/scripts/install-run-rush.js';

const COMMANDS = [
  // git
  'git commit -m "feat(api): add route"',
  'git commit -m "fix(web): handle #12" -m "body text"',
  'git add -A',
  'git add projects/sample/src/api/routes/notes.ts',
  'git status',
  'git status --short',
  'git diff',
  'git diff --stat HEAD~1',
  'git log --oneline -5',
  'git checkout -b feat/notes',
  'git switch main',
  'git checkout -- projects/x/src/a.ts',
  'git restore projects/x/src/a.ts',
  'git restore --staged projects/x/src/a.ts',
  'git stash push -- projects/x/src/a.ts',
  'git stash list',
  'git push -u origin feat/notes',
  'git fetch origin',
  'git rebase origin/main',
  // rush
  `${RUSH} build`,
  `${RUSH} verify`,
  `${RUSH} e2e`,
  `${RUSH} add -p zod`,
  `${RUSH} install`,
  `${RUSH} update`,
  // project tools
  'cd projects/sample && npx vitest run',
  'cd projects/sample && npx vitest run --coverage',
  'cd projects/sample/src/api-go && go test ./...',
  'cd projects/sample/src/api-go && go vet ./... && go build ./...',
  'cd projects/sample/src/api-py && uv run pytest',
  'cd projects/sample/src/api-py && uv run --locked mypy',
  'cd projects/sample/bruno && bru run --env local',
  'bru run projects/sample/bruno --env local',
  'npx eslint --max-warnings 0 projects/sample/src/api',
  'npx prettier --check projects/sample/src/api',
  'node --test projects/sample/src/contracts/test',
  'gh pr create --fill',
  'gh pr view 1',
  // the verify skill
  'bash .claude/hooks/stop-gate.sh --write-state-only',
  'cat .claude/state/last-verify.json',
  // plain source edits through the shell
  "sed -i '' s/a/b/ projects/x/src/a.ts",
  'echo "export const c = 3;" >> projects/x/src/a.ts',
  'cp /tmp/draft.ts projects/x/src/b.ts',
  'mkdir -p projects/x/src/routes && touch projects/x/src/routes/index.ts',
  'mv projects/x/src/old.ts projects/x/src/new.ts',
  'rm projects/x/src/old.ts',
  'rm -rf projects/x/dist',
  // reading a gate file is fine
  `node -e "console.log(require('fs').readFileSync('scripts/gates/gate-files.json','utf8'))"`,
  'cat scripts/gates/gate-files.json',
  'grep -rn "phase" scripts/gates/gate-files.json',
  'python3 -c "print(1)"',
  `node -e "console.log(JSON.parse(require('fs').readFileSync('rush.json','utf8')).projects.length)"`,
];

const SOURCE_FILES = [
  ['projects/sample/src/api/routes/notes.ts', "export const notes = (): string[] => ['a'];\n"],
  [
    'projects/sample/src/api/routes/notes.test.ts',
    "import { notes } from './notes';\n\nit('lists notes', () => {\n  expect(notes()).toEqual(['a']);\n});\n",
  ],
  [
    'projects/sample/web/test/home.test.tsx',
    "it('renders the heading', () => {\n  render(<Home />);\n  screen.getByRole('heading', { name: 'Notes' });\n});\n",
  ],
  [
    'projects/sample/src/api-go/internal/xmlread/read.go',
    'package xmlread\n\nfunc skipElement(dec *xml.Decoder) error {\n\treturn dec.Skip()\n}\n',
  ],
  [
    'projects/sample/src/api/repo/page.test.ts',
    "it('pages', () => {\n  const rows = db.find().skip(10).limit(5);\n  expect(rows).toBeDefined();\n});\n",
  ],
  [
    'projects/sample/src/api-py/tests/test_notes.py',
    'def test_notes():\n    assert notes() == ["a"]\n',
  ],
  ['scripts/tools/deploy.sh', 'set +e\necho deploy\n'],
  // Division after ++ or an identifier, and a folder named temp, are normal code.
  [
    'projects/sample/src/api/math.ts',
    'export const half = (i: number): number => {\n  let n = i;\n  const a = n++ / 2;\n  const b = n-- / 2;\n  return a + b; // a/b\n};\n',
  ],
  [
    'projects/sample/web/app/temp/page.tsx',
    'export default function Page(): string {\n  const temp = 20;\n  const average = temp / 2;\n  return String(average);\n}\n',
  ],
  [
    'projects/sample/src/api-go/internal/temp/convert.go',
    'package temp\n\nfunc Celsius(temp float64) float64 {\n\treturn (temp - 32) / 1.8\n}\n',
  ],
  ['projects/sample/src/api-go/internal/app/app_linux.go', '//go:build linux\n\npackage app\n'],
  [
    'projects/sample/src/api-py/tests/conftest.py',
    'import pytest\n\n\n@pytest.fixture\ndef client():\n    return object()\n\n\ndef pytest_configure(config):\n    config.addinivalue_line("markers", "slow: slow test")\n',
  ],
  [
    'projects/sample/src/api-py/src/sample_api/proc.py',
    'def ok(result):\n    return result.exitstatus == 0\n',
  ],
  [
    'scripts/tools/check.sh',
    'go test ./... || { echo failed; exit 1; }\nif ! pytest; then echo failed; exit 1; fi\n',
  ],
  ['scripts/tools/run.sh', 'go test ./... || echo "tests failed" && exit 1\n'],
  ['README.md', '# Notes\n'],
];

describe('normal work corpus', () => {
  let repository;

  before(() => {
    repository = makeRepository({
      'scripts/gates/gate-files.json': '{}\n',
      'projects/x/src/a.ts': 'export const a = 1;\n',
    });
    repository.write('.claude/state/last-verify.json', '{}\n');
  });
  after(() => repository.remove());

  const guard = (command) => callHook('guard-bash', bashCall(command), { root: repository.root });

  for (const command of COMMANDS) {
    it(`guard-bash allows: ${command}`, () => {
      const result = guard(command);
      assert.equal(result.status, 0, `${command}\n${result.stderr}`);
    });
  }

  it('protect-gates allows editing plain source files', () => {
    for (const [file, text] of SOURCE_FILES) {
      for (const tool of ['Write', 'Edit', 'MultiEdit']) {
        const result = callHook('protect-gates', editCall(tool, file, text), {
          root: repository.root,
        });
        assert.equal(result.status, 0, `${tool} ${file}\n${result.stderr}`);
      }
    }
  });

  it('anti-skip does not flag the source edits', () => {
    for (const [file, text] of SOURCE_FILES) {
      repository.write(file, text);
    }
    const result = exec('node', [CLI, '--root', repository.root, '--base', 'HEAD']);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  });

  it('anti-skip control: the same scan does flag a real skip, so the check above can fail', () => {
    repository.write(
      'projects/sample/src/api/control.test.ts',
      `it${'.skip'}('x', () => {\n  expect(1).toBe(1);\n});\n`,
    );
    const result = exec('node', [CLI, '--root', repository.root, '--base', 'HEAD']);
    assert.notEqual(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(`${result.stdout}${result.stderr}`, /test-skip-or-focus/);
    fs.rmSync(path.join(repository.root, 'projects/sample/src/api/control.test.ts'));
  });

  it('gate-integrity sees no gate change after a normal commit, with tool and cache folders on disk', () => {
    repository.write('projects/sample/src/api/routes/health.ts', 'export const ok = 1;\n');
    repository.git('add', '-A');
    assert.equal(
      exec('git', ['commit', '-q', '-m', 'feat(api): add route'], { cwd: repository.root }).status,
      0,
    );
    // These files are written after the commit, so they are not in HEAD. Only the prune list keeps
    // them out of the report.
    for (const file of [
      '.claude/state/session-base',
      'node_modules/x/scripts/a.sh',
      'node_modules/x/.gitignore',
      '.pytest_cache/.gitignore',
      '.ruff_cache/.gitignore',
      '.venv/lib/python3.12/site-packages/argcomplete/scripts/a.py',
      'projects/sample/src/api-py/.venv/pyvenv.cfg',
      'projects/sample/dist/api/index.js',
      'projects/sample/rush-logs/api._phase_build.log',
      'projects/sample/cdk.out/manifest.json',
      'common/temp/pnpm-lock.yaml',
    ]) {
      repository.write(file, 'x\n');
    }
    assert.deepEqual(uncommitted(repository.root), []);
  });
});

// Tests for the pure parts of scripts/lint-on-edit.mjs. No test runs ESLint or tsc.
import { describe, expect, it } from 'vitest';

import {
  buildFeedback,
  findProject,
  findTsconfig,
  formatEslint,
  formatTsc,
  isLintable,
  readFilePath,
  readProjectFolders,
  run,
  toHookOutput,
} from '../scripts/lint-on-edit.mjs';

const ROOT = '/repo';
const FOLDERS = ['packages/result', 'projects/sample', 'tooling/eslint-config'];

describe('readFilePath', () => {
  it('reads tool_input.file_path', () => {
    expect(readFilePath('{"tool_input":{"file_path":"/repo/a.ts"}}')).toBe('/repo/a.ts');
  });

  it('gives undefined for bad JSON or a missing path', () => {
    expect(readFilePath('not json')).toBeUndefined();
    expect(readFilePath('{"tool_input":{}}')).toBeUndefined();
    expect(readFilePath('{"tool_input":{"file_path":3}}')).toBeUndefined();
  });
});

describe('isLintable', () => {
  it.each(['a.ts', 'a.tsx', 'a.js', 'a.mjs', 'a.cjs'])('accepts %s', (file) => {
    expect(isLintable(`/repo/packages/result/src/${file}`)).toBe(true);
  });

  it.each([
    '/repo/docs/a.md',
    '/repo/packages/result/package.json',
    '/repo/tooling/templates/library/src/index.ts.tmpl',
    '/repo/packages/result/dist/index.js',
    '/repo/projects/sample/web/.next/a.js',
    '/repo/projects/sample/node_modules/x/a.js',
    '/repo/projects/sample/coverage/a.js',
    '/repo/projects/sample/cdk.out/a.js',
  ])('skips %s', (file) => {
    expect(isLintable(file)).toBe(false);
  });
});

describe('readProjectFolders', () => {
  it('reads the folders from rush.json with comments', () => {
    const text =
      '/* c */ {\n // x\n "projects": [{ "projectFolder": "a/b" }, {"projectFolder":"c"}]}';
    expect(readProjectFolders(text)).toEqual(['a/b', 'c']);
  });
});

describe('findProject', () => {
  it('finds the project of a file', () => {
    expect(findProject(ROOT, '/repo/projects/sample/web/app/page.tsx', FOLDERS)).toBe(
      'projects/sample',
    );
  });

  it('takes the longest match', () => {
    expect(findProject(ROOT, '/repo/a/b/c.ts', ['a', 'a/b'])).toBe('a/b');
  });

  it('gives undefined outside each project', () => {
    expect(findProject(ROOT, '/repo/scripts/a.mjs', FOLDERS)).toBeUndefined();
    expect(findProject(ROOT, '/repo/packages/result-two/a.ts', FOLDERS)).toBeUndefined();
    expect(findProject(ROOT, '/other/packages/result/a.ts', FOLDERS)).toBeUndefined();
  });
});

describe('findTsconfig', () => {
  const project = '/repo/projects/sample';
  const files = new Set([`${project}/tsconfig.json`, `${project}/web/tsconfig.json`]);
  /** @param {string} file - Path. @returns {boolean} True when the fake file exists. */
  const fileExists = (file) => files.has(file);

  it('takes the nearest tsconfig.json', () => {
    expect(findTsconfig(project, `${project}/web/app/page.tsx`, fileExists)).toBe(
      `${project}/web/tsconfig.json`,
    );
    expect(findTsconfig(project, `${project}/src/a/b.ts`, fileExists)).toBe(
      `${project}/tsconfig.json`,
    );
  });

  it('stops at the project folder', () => {
    expect(findTsconfig(project, `${project}/src/a.ts`, () => false)).toBeUndefined();
    expect(findTsconfig(project, '/repo/x.ts', fileExists)).toBeUndefined();
  });
});

describe('formatEslint', () => {
  it('gives one line for each message', () => {
    const json = JSON.stringify([
      {
        filePath: '/repo/packages/result/src/a.ts',
        messages: [
          { line: 3, column: 7, severity: 2, message: 'Bad.', ruleId: 'no-console' },
          { line: 4, column: 1, severity: 1, message: 'Parse.', ruleId: null },
        ],
      },
    ]);
    expect(formatEslint(json, ROOT)).toEqual([
      'packages/result/src/a.ts:3:7 error Bad. (no-console)',
      'packages/result/src/a.ts:4:1 warning Parse.',
    ]);
  });

  it('caps the output at 20 lines', () => {
    const messages = Array.from({ length: 25 }, () => ({ severity: 2, message: 'x' }));
    const lines = formatEslint(JSON.stringify([{ filePath: '/repo/a.ts', messages }]), ROOT);
    expect(lines).toHaveLength(21);
    expect(lines.at(-1)).toBe('... 5 more');
    expect(lines[0]).toBe('a.ts:0:0 error x');
  });
});

describe('formatTsc', () => {
  it('keeps only the error lines', () => {
    const output = [
      "src/a.ts(2,7): error TS2322: Type 'number' is not assignable to type 'string'.",
      '  extra detail',
      '',
    ].join('\n');
    expect(formatTsc(output)).toEqual([
      "src/a.ts(2,7): error TS2322: Type 'number' is not assignable to type 'string'.",
    ]);
  });
});

describe('buildFeedback', () => {
  it('stays silent without findings', () => {
    expect(buildFeedback('a.ts', { eslint: [], tsc: [] })).toBeUndefined();
  });

  it('lists the findings of each tool', () => {
    const text = buildFeedback('a.ts', { eslint: ['e1'], tsc: ['t1'] });
    expect(text).toBe(
      'lint-on-edit found problems after the edit of a.ts.\n\nESLint findings:\ne1\n\nTypeScript findings:\nt1',
    );
    expect(buildFeedback('a.ts', { eslint: [], tsc: ['t1'] })).not.toContain('ESLint');
  });
});

describe('toHookOutput', () => {
  it('gives PostToolUse additionalContext', () => {
    expect(JSON.parse(toHookOutput('x'))).toEqual({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'x' },
    });
  });
});

describe('run', () => {
  it('skips a file that is not source code or not in a project', () => {
    expect(run('{"tool_input":{"file_path":"/repo/docs/a.md"}}')).toBeUndefined();
    expect(run('{"tool_input":{"file_path":"relative/a.ts"}}')).toBeUndefined();
    expect(run('{"tool_input":{"file_path":"/nowhere/a.ts"}}')).toBeUndefined();
    expect(run('{}')).toBeUndefined();
  });
});

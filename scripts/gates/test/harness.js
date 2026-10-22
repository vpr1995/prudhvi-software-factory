// Shared helpers for the gate tests: temp git repos and a runner for the hook wrappers.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { environmentWith } from './env.config.js';

export const GATES = path.resolve(import.meta.dirname, '..');
export const REPOSITORY = path.resolve(GATES, '..', '..');
const HOOKS = path.join(REPOSITORY, '.claude', 'hooks');

const RUSH_STUB = `// Test stub for common/scripts/install-run-rush.js
const fs = require('node:fs');
const path = require('node:path');
const temp = path.join(__dirname, '..', 'temp');
fs.appendFileSync(path.join(temp, 'stub-calls.log'), process.argv.slice(2).join(' ') + '\\n');
if (fs.existsSync(path.join(temp, 'stub-fail'))) {
  console.log('==[ FAILURE: 1 operation ]==============');
  console.log('--[ FAILURE: @t/a (lint) ]----------[ 1 second ]--');
  console.log('');
  console.log('src/a.ts:1:1 error stub lint failure');
  console.log('');
  console.log('Operations failed.');
  process.exit(1);
}
console.log('rush stub ok');
`;

const BASE_FILES = {
  '.gitignore': 'common/temp/\n.claude/state/\nnode_modules/\n',
  'rush.json': JSON.stringify({ projects: [{ packageName: '@t/a', projectFolder: 'packages/a' }] }),
  'packages/a/package.json': '{"name":"@t/a","version":"1.0.0"}\n',
  'packages/a/src/a.ts': 'export const value = 1;\n',
  'common/scripts/install-run-rush.js': RUSH_STUB,
};

/**
 * Turns camelCase keys into snake_case keys, deeply. The hook input of Claude Code uses snake_case.
 *
 * @param {unknown} value - A value built with camelCase keys.
 * @returns {unknown} The same value with snake_case keys.
 */
export function toHookInput(value) {
  if (Array.isArray(value)) {
    return value.map((item) => toHookInput(item));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        toHookInput(item),
      ]),
    );
  }
  return value;
}

/**
 * Runs a program and returns text output.
 *
 * @param {string} program - Program.
 * @param {string[]} args - Arguments.
 * @param {{ cwd?: string, input?: string, env?: Record<string, string> }} [options] - Options.
 * @returns {{ status: number, stdout: string, stderr: string }} Result.
 */
export function exec(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: options.cwd,
    input: options.input,
    encoding: 'utf8',
    env: environmentWith(options.env),
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * Makes a temp git repo with a Rush stub, one project and one commit.
 *
 * @param {Record<string, string>} [extraFiles] - Files to add to the first commit.
 * @returns {{ root: string, write: (name: string, text: string) => void, git: (...args: string[]) => string, read: (name: string) => string | null, exists: (name: string) => boolean, remove: () => void }} The repo.
 */
export function makeRepository(extraFiles = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gates-test-')));
  const write = (name, text) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const git = (...args) => exec('git', args, { cwd: root }).stdout;
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  for (const [name, text] of Object.entries({ ...BASE_FILES, ...extraFiles })) {
    write(name, text);
  }
  fs.mkdirSync(path.join(root, 'common', 'temp'), { recursive: true });
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return {
    root,
    write,
    git,
    read: (name) =>
      fs.existsSync(path.join(root, name)) ? fs.readFileSync(path.join(root, name), 'utf8') : null,
    exists: (name) => fs.existsSync(path.join(root, name)),
    remove: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Calls a hook wrapper from .claude/hooks like Claude Code does.
 *
 * @param {string} name - Hook name without `.sh`.
 * @param {Record<string, unknown> | string | null} payload - JSON for stdin (a string is sent as is, null sends nothing).
 * @param {{ root: string, args?: string[], env?: Record<string, string> }} options - The repo root and extras.
 * @returns {{ status: number, stdout: string, stderr: string }} Result.
 */
export function callHook(name, payload, options) {
  const input =
    payload === null
      ? ''
      : typeof payload === 'string'
        ? payload
        : JSON.stringify(toHookInput({ cwd: options.root, ...payload }));
  return exec('bash', [path.join(HOOKS, `${name}.sh`), ...(options.args ?? [])], {
    cwd: options.root,
    input,
    env: { CLAUDE_PROJECT_DIR: options.root, ...options.env },
  });
}

/**
 * Builds the input of a Bash tool call.
 *
 * @param {string} command - The command line.
 * @returns {Record<string, unknown>} Payload.
 */
export function bashCall(command) {
  return { hookEventName: 'PreToolUse', toolName: 'Bash', toolInput: { command } };
}

/**
 * Builds the input of a file-editing tool call.
 *
 * @param {string} tool - Tool name: Write, Edit, MultiEdit or NotebookEdit.
 * @param {string} file - Path.
 * @param {string} [text] - New text.
 * @returns {Record<string, unknown>} Payload.
 */
export function editCall(tool, file, text = 'x') {
  /** @type {Record<string, unknown>} */
  const input =
    tool === 'NotebookEdit' ? { notebookPath: file, newSource: text } : { filePath: file };
  if (tool === 'Write') {
    input['content'] = text;
  } else if (tool === 'Edit') {
    Object.assign(input, { oldString: 'a', newString: text });
  } else if (tool === 'MultiEdit') {
    input['edits'] = [{ oldString: 'a', newString: text }];
  }
  return { hookEventName: 'PreToolUse', toolName: tool, toolInput: input };
}

import path from 'node:path';

import { exists, readJson } from './fs-io.mjs';
import { GO_TOOLS } from './gates.config.mjs';
import { clipLines, stripAnsi } from './hook-io.mjs';
import { run, which } from './proc.mjs';
import { findManifestDirectory } from './projects.mjs';

/**
 * @typedef {object} ToolResult
 * @property {boolean} ran - False when the tool was not found, so the check was skipped.
 * @property {boolean} failed - True when the tool reported problems.
 * @property {string} output - Tool output (clipped, no colors).
 * @property {string} note - Why the check was skipped, if it was.
 */

const SKIPPED_SEGMENTS = new Set([
  'node_modules',
  'dist',
  '.next',
  'coverage',
  'cdk.out',
  '.venv',
  '__pycache__',
  'test-results',
  'playwright-report',
  'rush-logs',
  '.rush',
]);
const SOURCE_NAMED_SEGMENTS = new Set(['coverage', 'dist']);
const ESLINT_CONFIGS = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
];
const TOOL_TIMEOUT_MS = 180_000;
const OUTPUT_LINES = 40;

/**
 * Tells whether a file is generated or tool-owned, so hooks leave it alone.
 *
 * @param {string} relativePath - Path from the repo root.
 * @returns {boolean} True when the hooks must skip it.
 */
export function shouldSkipFile(relativePath) {
  const parts = relativePath.split('/');
  const skipped = parts.findIndex((part) => SKIPPED_SEGMENTS.has(part));
  // A source folder such as src/coverage or src/dist is code, not build output. Tool folders
  // (node_modules, .venv, __pycache__) are never code, even under src.
  const underSource =
    skipped !== -1 &&
    SOURCE_NAMED_SEGMENTS.has(parts[skipped] ?? '') &&
    parts.slice(0, skipped).includes('src');
  return (
    (skipped !== -1 && !underSource) ||
    relativePath.startsWith('.claude/state/') ||
    relativePath.startsWith('common/temp/')
  );
}

/**
 * Makes a file name safe to pass to a tool as a path argument. A name that starts with `-` would
 * be read as an option, so a relative name gets a `./` prefix.
 *
 * @param {string} file - File path.
 * @returns {string} The path, absolute or starting with `./` or `../`.
 */
export function asPathArgument(file) {
  return file.startsWith('/') || file.startsWith('./') || file.startsWith('../')
    ? file
    : `./${file}`;
}

/**
 * @param {string} directory - Project folder.
 * @param {string} name - Tool name.
 * @returns {string | null} Path of `node_modules/.bin/<name>`, or null.
 */
export function localBinary(directory, name) {
  const candidate = path.join(directory, 'node_modules', '.bin', name);
  return exists(candidate) ? candidate : null;
}

/**
 * @param {string} root - Repo root.
 * @returns {string | null} The Prettier binary from the rush-lint-staged autoinstaller, or from PATH.
 */
export function prettierBinary(root) {
  return (
    localBinary(path.join(root, 'common', 'autoinstallers', 'rush-lint-staged'), 'prettier') ??
    which('prettier')
  );
}

/**
 * Makes a clipped, colorless tool result.
 *
 * @param {import('./proc.mjs').RunResult} result - The process result.
 * @returns {ToolResult} Tool result.
 */
function toToolResult(result) {
  const text = stripAnsi(`${result.stdout}${result.stderr}`);
  return {
    ran: result.started,
    failed: result.status !== 0,
    output: clipLines(text, OUTPUT_LINES),
    note: '',
  };
}

/**
 * Runs Prettier on a file (it rewrites the file).
 *
 * @param {string} root - Repo root.
 * @param {string} relativePath - File path from the repo root.
 * @returns {ToolResult} Result.
 */
export function runPrettier(root, relativePath) {
  const binary = prettierBinary(root);
  if (binary === null) {
    return {
      ran: false,
      failed: false,
      output: '',
      note: 'prettier is not installed (run rush install), formatting skipped',
    };
  }
  const result = run(binary, ['--write', '--ignore-unknown', asPathArgument(relativePath)], {
    cwd: root,
    timeoutMs: TOOL_TIMEOUT_MS,
  });
  return toToolResult(result);
}

/**
 * Runs ESLint with --fix on a file. It uses the project's own eslint and config when present,
 * else the shared binary with the root config.
 *
 * @param {string} root - Repo root.
 * @param {string} relativePath - File path from the repo root.
 * @returns {ToolResult} Result. `failed` means errors are left after the fix.
 */
export function runEslint(root, relativePath) {
  const manifest = findManifestDirectory(root, path.join(root, relativePath));
  const projectBinary = manifest === null ? null : localBinary(manifest.directory, 'eslint');
  const hasConfig =
    manifest !== null && ESLINT_CONFIGS.some((name) => exists(path.join(manifest.directory, name)));
  const shared = localBinary(path.join(root, 'tooling', 'eslint-config'), 'eslint');
  const useProject = projectBinary !== null && hasConfig && manifest !== null;
  const binary = useProject ? projectBinary : shared;
  if (binary === null) {
    return {
      ran: false,
      failed: false,
      output: '',
      note: 'eslint is not installed (run rush install), lint skipped',
    };
  }
  const cwd = useProject && manifest !== null ? manifest.directory : root;
  const target = asPathArgument(path.relative(cwd, path.join(root, relativePath)));
  const result = run(binary, ['--fix', '--max-warnings', '0', '--no-warn-ignored', target], {
    cwd,
    timeoutMs: TOOL_TIMEOUT_MS,
  });
  const asTool = toToolResult(result);
  // ESLint exit code 2 means the tool itself failed (bad config), not that the code has errors.
  return result.status === 2
    ? {
        ...asTool,
        failed: false,
        note: `eslint could not run: ${asTool.output.split('\n')[0] ?? ''}`,
      }
    : asTool;
}

/**
 * Finds a Python tool for a project: its own venv, `uv run`, or `uvx` (ruff only).
 *
 * @param {string} directory - Project folder.
 * @param {string} tool - `ruff` or `mypy`.
 * @returns {{ program: string, args: string[] } | null} How to start it, or null.
 */
export function pythonTool(directory, tool) {
  const venv = path.join(directory, '.venv', 'bin', tool);
  if (exists(venv)) {
    return { program: venv, args: [] };
  }
  if (which('uv') !== null && exists(path.join(directory, 'uv.lock'))) {
    return { program: 'uv', args: ['run', '--frozen', tool] };
  }
  return tool === 'ruff' && which('uvx') !== null ? { program: 'uvx', args: [tool] } : null;
}

/**
 * Formats and lints a Python file with ruff.
 *
 * @param {string} directory - Project folder.
 * @param {string} file - Absolute file path.
 * @returns {ToolResult} Result. `failed` means ruff check found problems left after the fix.
 */
export function runRuff(directory, file) {
  const tool = pythonTool(directory, 'ruff');
  if (tool === null) {
    return {
      ran: false,
      failed: false,
      output: '',
      note: 'ruff is not available (install uv), Python lint skipped',
    };
  }
  const options = { cwd: directory, timeoutMs: TOOL_TIMEOUT_MS };
  run(tool.program, [...tool.args, 'format', file], options);
  return toToolResult(run(tool.program, [...tool.args, 'check', '--fix', file], options));
}

/**
 * Runs mypy for a Python project.
 *
 * @param {string} directory - Project folder.
 * @returns {ToolResult} Result.
 */
export function runMypy(directory) {
  const tool = pythonTool(directory, 'mypy');
  if (tool === null) {
    return {
      ran: false,
      failed: false,
      output: '',
      note: 'mypy is not available in the project venv, Python typecheck skipped',
    };
  }
  return toToolResult(
    run(tool.program, [...tool.args, '.'], { cwd: directory, timeoutMs: TOOL_TIMEOUT_MS }),
  );
}

/**
 * Finds a Go formatter: on PATH, or through `go run` with a pinned module version.
 *
 * @param {'gofumpt' | 'goimports'} tool - Tool name.
 * @returns {{ program: string, args: string[] } | null} How to start it, or null.
 */
function goFormatter(tool) {
  const found = which(tool);
  if (found !== null) {
    return { program: found, args: [] };
  }
  return which('go') === null ? null : { program: 'go', args: ['run', GO_TOOLS[tool] ?? tool] };
}

/**
 * Formats a Go file (gofumpt, then goimports) and runs `go vet` on its package.
 *
 * @param {string} directory - Module folder (has go.mod).
 * @param {string} file - Absolute file path.
 * @returns {ToolResult} Result. `failed` means `go vet` found problems.
 */
export function runGo(directory, file) {
  if (which('go') === null) {
    return {
      ran: false,
      failed: false,
      output: '',
      note: 'go is not installed, Go checks skipped',
    };
  }
  const notes = [];
  for (const tool of /** @type {const} */ (['gofumpt', 'goimports'])) {
    const formatter = goFormatter(tool);
    const flags = tool === 'gofumpt' ? ['-w'] : ['-w'];
    const result =
      formatter === null
        ? null
        : run(formatter.program, [...formatter.args, ...flags, file], {
            cwd: directory,
            timeoutMs: TOOL_TIMEOUT_MS,
          });
    if (result === null || result.status !== 0) {
      notes.push(`${tool} could not run, formatting skipped`);
    }
  }
  const vet = toToolResult(
    run('go', ['vet', `./${path.relative(directory, path.dirname(file)) || '.'}`], {
      cwd: directory,
      timeoutMs: TOOL_TIMEOUT_MS,
    }),
  );
  return { ...vet, note: notes.join('; ') };
}

const SHELL_CONTROL = /[;|&]/;

/**
 * Builds the tsc arguments for a project. A given tsconfig (a part folder such as web) wins.
 * Else the arguments come from the `_phase:typecheck` script when that script is one plain
 * `tsc` command (a chain of commands is not a tsc command line), else from tsconfig.json.
 *
 * @param {string} directory - Project folder.
 * @param {string} [tsconfig] - tsconfig path from the project folder, for example `web/tsconfig.json`.
 * @returns {string[] | null} Arguments for tsc, or null when the project has no tsconfig.
 */
function tscArguments(directory, tsconfig) {
  if (tsconfig !== undefined) {
    return exists(path.join(directory, tsconfig)) ? ['-p', tsconfig, '--noEmit'] : null;
  }
  const manifest = readJson(path.join(directory, 'package.json'));
  const script =
    manifest !== null && typeof manifest === 'object'
      ? manifest.scripts?.['_phase:typecheck']
      : undefined;
  const fromScript =
    typeof script === 'string' && !SHELL_CONTROL.test(script)
      ? /^tsc\s+(.*)$/.exec(script.trim())?.[1]?.split(/\s+/)
      : undefined;
  const usable =
    fromScript !== undefined && !fromScript.some((word) => word === '-b' || word === '--build');
  if (usable) {
    return fromScript.includes('--noEmit') ? fromScript : [...fromScript, '--noEmit'];
  }
  return exists(path.join(directory, 'tsconfig.json')) ? ['-p', 'tsconfig.json', '--noEmit'] : null;
}

/**
 * Lists the tsconfig files of a project that the edit hooks check: the root one, and the one in
 * the `web` part folder (the web part has no package.json of its own).
 *
 * @param {string} directory - Project folder (has package.json).
 * @returns {string[]} Paths from the project folder.
 */
export function projectTsconfigs(directory) {
  return ['tsconfig.json', 'web/tsconfig.json'].filter((file) =>
    exists(path.join(directory, file)),
  );
}

/**
 * Runs `tsc --noEmit` for a TypeScript project (incremental). The compiler comes from the project
 * folder, also when the tsconfig is in a part folder.
 *
 * @param {string} directory - Project folder.
 * @param {string} [tsconfig] - tsconfig path from the project folder, for example `web/tsconfig.json`.
 * @returns {ToolResult} Result. `failed` means type errors.
 */
export function runTsc(directory, tsconfig) {
  const binary = localBinary(directory, 'tsc');
  const base = tscArguments(directory, tsconfig);
  if (binary === null || base === null) {
    return {
      ran: false,
      failed: false,
      output: '',
      note: 'tsc or tsconfig.json is missing in the project, typecheck skipped',
    };
  }
  const cacheName =
    tsconfig === undefined
      ? 'claude-typecheck'
      : `claude-typecheck-${path.dirname(tsconfig).replaceAll(/[^\w-]/g, '_')}`;
  const cache = path.join(directory, 'node_modules', '.cache', `${cacheName}.tsbuildinfo`);
  const options = { cwd: directory, timeoutMs: TOOL_TIMEOUT_MS };
  let result = run(binary, [...base, '--incremental', '--tsBuildInfoFile', cache], options);
  if (result.status !== 0 && /error TS[56]\d{3}/.test(result.stdout)) {
    result = run(binary, base, options);
  }
  return toToolResult(result);
}

/**
 * Runs `go build ./...` for a Go module.
 *
 * @param {string} directory - Module folder.
 * @returns {ToolResult} Result.
 */
export function runGoBuild(directory) {
  if (which('go') === null) {
    return {
      ran: false,
      failed: false,
      output: '',
      note: 'go is not installed, Go typecheck skipped',
    };
  }
  return toToolResult(
    run('go', ['build', './...'], { cwd: directory, timeoutMs: TOOL_TIMEOUT_MS }),
  );
}

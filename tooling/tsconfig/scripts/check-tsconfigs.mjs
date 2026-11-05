// Check every tsconfig in the repo. Only tooling/tsconfig holds strictness.
//
// Rule A: each tsconfig extends a shared preset, or another tsconfig that does.
// Rule B: a tsconfig has only the top-level keys in ALLOWED_TOP_LEVEL.
// Rule C: a tsconfig sets only the compiler options in ALLOWED_COMPILER_OPTIONS.
//
// To add an option, edit the lists below. A human reviews that change.
// Run: node tooling/tsconfig/scripts/check-tsconfigs.mjs
import { execFileSync } from 'node:child_process';
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readRepositoryFile } from './lib/fs-io.mjs';

export const PRESET_PREFIX = '@vprprudhvi/tooling-tsconfig/';

export const ALLOWED_TOP_LEVEL = [
  '$schema',
  'extends',
  'compilerOptions',
  'include',
  'exclude',
  'files',
  'references',
];

// Layout, output and environment options only. No strictness or type-check flags.
export const ALLOWED_COMPILER_OPTIONS = [
  'rootDir',
  'rootDirs',
  'outDir',
  'declarationDir',
  'tsBuildInfoFile',
  'noEmit',
  'incremental',
  'composite',
  'declaration',
  'declarationMap',
  'sourceMap',
  'jsx',
  'lib',
  'types',
  'typeRoots',
  'paths',
  'baseUrl',
  'plugins',
  'allowJs',
  'checkJs',
  'allowImportingTsExtensions',
  'rewriteRelativeImportExtensions',
  'emitDeclarationOnly',
];

// The preset files themselves are the one place that holds strictness.
const PRESET_FILE = /^tooling\/tsconfig\/[^/]+\.json$/;

const ALLOWED_OPTION_SET = new Set(ALLOWED_COMPILER_OPTIONS.map((name) => name.toLowerCase()));
const ALLOWED_TOP_LEVEL_SET = new Set(ALLOWED_TOP_LEVEL);

// Return the index after the string that starts at `start`.
function stringEnd(text, start) {
  let position = start + 1;
  while (position < text.length && text[position] !== '"') {
    position += text[position] === '\\' ? 2 : 1;
  }
  return position + 1;
}

// Return the index after the comment that starts at `start`. Return -1 when there is no comment.
function commentEnd(text, start) {
  const marker = text.slice(start, start + 2);
  if (marker === '//') {
    const lineEnd = text.indexOf('\n', start);
    return lineEnd === -1 ? text.length : lineEnd;
  }
  if (marker === '/*') {
    const close = text.indexOf('*/', start + 2);
    return close === -1 ? text.length : close + 2;
  }
  return -1;
}

function stripComments(text) {
  let output = '';
  let position = 0;
  while (position < text.length) {
    const end = text[position] === '"' ? stringEnd(text, position) : commentEnd(text, position);
    if (end === -1) {
      output += text[position];
      position += 1;
    } else {
      output += text[position] === '"' ? text.slice(position, end) : ' ';
      position = end;
    }
  }
  return output;
}

// A comma is trailing when only white space follows it, then "}" or "]".
function isTrailingComma(text, start) {
  let position = start + 1;
  while (position < text.length && /\s/.test(text[position])) position += 1;
  return text[position] === '}' || text[position] === ']';
}

// Input has no comments here. Skip strings so a "," inside a string stays.
function removeTrailingCommas(text) {
  let output = '';
  let position = 0;
  while (position < text.length) {
    if (text[position] === '"') {
      const end = stringEnd(text, position);
      output += text.slice(position, end);
      position = end;
    } else {
      if (text[position] !== ',' || !isTrailingComma(text, position)) output += text[position];
      position += 1;
    }
  }
  return output;
}

/** Remove comments and trailing commas from JSONC. String contents stay as they are. */
export function stripJsonc(text) {
  return removeTrailingCommas(stripComments(text));
}

export function parseJsonc(text) {
  return JSON.parse(stripJsonc(text));
}

const NO_PRESET = `Extend a preset from ${PRESET_PREFIX}*`;

// Reason why one "extends" entry does not reach a shared preset. Empty text when it does.
function entryReason(entry, context) {
  if (typeof entry !== 'string') return '"extends" must hold strings';
  if (entry.startsWith(PRESET_PREFIX)) return '';
  if (!entry.startsWith('.')) {
    return `extends "${entry}": use a preset from ${PRESET_PREFIX}* or a relative tsconfig`;
  }
  const target = context.load(context.file, entry);
  if (target === undefined) return `extends "${entry}": not a tsconfig of this repo. ${NO_PRESET}`;
  if (context.seen.has(target.file)) return `extends "${entry}": circular extends`;
  const inner = extendsReasons(target.config, {
    file: target.file,
    load: context.load,
    seen: new Set([...context.seen, target.file]),
  });
  return inner.length > 0 ? `extends "${entry}": it does not reach a ${PRESET_PREFIX}* preset` : '';
}

// Rule A. Context: { file, load, seen }. `load(fromFile, ref)` returns { file, config } or undefined.
function extendsReasons(config, context) {
  const declared = config.extends;
  if (declared === undefined) return [`no "extends". ${NO_PRESET}`];
  const entries = Array.isArray(declared) ? declared : [declared];
  if (entries.length === 0) return [`empty "extends". ${NO_PRESET}`];
  return entries.map((entry) => entryReason(entry, context)).filter((reason) => reason !== '');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Rules B and C.
function keyReasons(config) {
  const reasons = [];
  for (const key of Object.keys(config)) {
    if (!ALLOWED_TOP_LEVEL_SET.has(key)) {
      reasons.push(
        `top-level key "${key}" is not allowed. Move it to tooling/tsconfig or remove it`,
      );
    }
  }
  const options = config.compilerOptions;
  if (options === undefined) return reasons;
  if (!isPlainObject(options)) return [...reasons, '"compilerOptions" must be an object'];
  for (const key of Object.keys(options)) {
    if (!ALLOWED_OPTION_SET.has(key.toLowerCase())) {
      reasons.push(
        `compilerOption "${key}" is not allowed. Move it to tooling/tsconfig or remove it`,
      );
    }
  }
  return reasons;
}

/** Validate one parsed tsconfig. Return a list of short reasons. Empty list means ok. */
export function validateConfig(file, config, load) {
  if (!isPlainObject(config)) return ['top level must be an object'];
  const context = { file, load, seen: new Set([file]) };
  return [...extendsReasons(config, context), ...keyReasons(config)];
}

export function listTsconfigs(root) {
  const out = execFileSync('git', ['ls-files', '-z', '--', '*tsconfig*.json'], {
    cwd: root,
    encoding: 'utf8',
  });
  return out.split('\0').filter((name) => name !== '' && !PRESET_FILE.test(name));
}

// Build the loader for relative extends. It reads and parses each repo tsconfig once.
function createLoader(root, files) {
  const fileSet = new Set(files);
  const cache = new Map();
  const read = (file) => {
    if (!cache.has(file)) {
      try {
        cache.set(file, { config: parseJsonc(readRepositoryFile(root, file)) });
      } catch (error) {
        cache.set(file, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    return cache.get(file);
  };
  const load = (fromFile, ref) => {
    const withExtension = ref.endsWith('.json') ? ref : `${ref}.json`;
    const target = posix.join(posix.dirname(fromFile), withExtension);
    const entry = fileSet.has(target) ? read(target) : undefined;
    return entry?.config === undefined ? undefined : { file: target, config: entry.config };
  };
  return { read, load };
}

export function main() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const files = listTsconfigs(root);
  const { read, load } = createLoader(root, files);

  const lines = [];
  for (const file of files) {
    const entry = read(file);
    const reasons =
      entry.error === undefined
        ? validateConfig(file, entry.config, load)
        : [`invalid JSON: ${entry.error}`];
    for (const reason of reasons) lines.push(`tsconfig-check: ${file}: ${reason}`);
  }
  if (lines.length > 0) {
    process.stderr.write(`${lines.join('\n')}\n`);
    return 1;
  }
  process.stdout.write(`tsconfig-check: ${files.length} files ok\n`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}

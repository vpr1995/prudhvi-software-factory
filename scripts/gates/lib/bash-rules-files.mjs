import path from 'node:path';

import { gateHitForWord } from './bash-paths.mjs';
import { checkIncomingFiles } from './bash-rules-vcs.mjs';
import { fileSize, readText } from './fs-io.mjs';
import { findGate, unlockText } from './gate-list.mjs';
import { canWrite } from './inline-code.mjs';
import { programName } from './shell-parse.mjs';

/**
 * @typedef {import('./shell-parse.mjs').Segment} Segment
 * @typedef {import('./bash-paths.mjs').PathScope} PathScope
 * @typedef {import('./bash-rules-git.mjs').GuardContext} GuardContext
 */

const SAFE_DELETE_NAMES = new Set([
  'temp',
  'tmp',
  'dist',
  '.next',
  'coverage',
  'cdk.out',
  'playwright-report',
  'test-results',
  '.pytest_cache',
  '__pycache__',
  '.mypy_cache',
  '.ruff_cache',
]);
const SAFE_DELETE_PREFIXES = [
  '/tmp/',
  '/private/tmp/',
  '/var/folders/',
  '/private/var/folders/',
  '$TMPDIR/',
  '${TMPDIR}/',
];
const ALL_ARGUMENT_WRITERS = new Set([
  'rm',
  'unlink',
  'shred',
  'truncate',
  'tee',
  'mv',
  'chmod',
  'chown',
  'chgrp',
  'chattr',
  'setfacl',
  'touch',
  'ed',
  'ex',
  'vi',
  'vim',
  'nvim',
  'nano',
  'sponge',
]);
const LAST_ARGUMENT_WRITERS = new Set(['cp', 'install', 'rsync']);
const INTERPRETER_NAME = /^(?:python[0-9.]*|node|nodejs|ruby|perl|deno|bun|php|lua|awk|gawk|mawk)$/;
const SHELL_NAME = /^(?:bash|sh|zsh|dash|ksh|source|\.)$/;
const CODE_FLAG = /^-[a-zA-Z]*[ceEp]$|^--eval$/;
const WRITE_WORDS =
  /(write|open\(|append|unlink|rename|copy|move|remove|truncate|chmod|chown|replace|link|\brm\b|\bmv\b|\bcp\b|\bsed\b|\bdd\b|echo|printf|\btee\b|dump|exec|spawn|system|popen|subprocess|shutil|touch|mkdir|install|\bsh\b|\bbash\b|>)/i;
const WORD_IN_CODE = /[A-Za-z0-9_.@/-]+/g;
const SCRIPT_SKIPPED_FOLDERS =
  /(?:^|\/)(?:node_modules|dist|\.next|common\/temp|\.venv|coverage)(?:\/|$)/;
const MAX_SCRIPT_BYTES = 200_000;

/**
 * Collects the non-flag words of a command (everything after `--` counts as a word).
 *
 * @param {string[]} words - Arguments (without the program name).
 * @returns {string[]} The operands.
 */
function operands(words) {
  const marker = words.indexOf('--');
  const head = marker === -1 ? words : words.slice(0, marker);
  const tail = marker === -1 ? [] : words.slice(marker + 1);
  return [...head.filter((word) => !word.startsWith('-')), ...tail];
}

/**
 * Tells whether `rm` (or similar) runs in recursive mode.
 *
 * @param {string[]} words - Arguments.
 * @returns {boolean} True for -r, -R, -rf, --recursive.
 */
function isRecursive(words) {
  return words.some((word) => word === '--recursive' || /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(word));
}

/**
 * Tells whether a recursive delete of this target is allowed.
 *
 * @param {string} target - One operand of `rm -r`.
 * @returns {boolean} True when the target is a temp or build output folder.
 */
function isSafeDeleteTarget(target) {
  if (SAFE_DELETE_PREFIXES.some((prefix) => target.startsWith(prefix))) {
    return !target.includes('/../');
  }
  const normalized = path.posix.normalize(target.replaceAll(/\/+$/g, '') || '/');
  return normalized.split('/').some((part) => SAFE_DELETE_NAMES.has(part));
}

/**
 * Finds the folders `find` deletes from (`-delete` or `-exec rm`).
 *
 * @param {string[]} words - Arguments of find.
 * @returns {string[]} The start folders, or an empty list when find does not delete.
 */
function findDeleteTargets(words) {
  const execIndex = words.findIndex((word) => word === '-exec' || word === '-execdir');
  const deletes = words.includes('-delete') || (execIndex !== -1 && words[execIndex + 1] === 'rm');
  if (!deletes) {
    return [];
  }
  const firstExpression = words.findIndex(
    (word) => word.startsWith('-') || word === '(' || word === '!',
  );
  const starts = firstExpression === -1 ? words : words.slice(0, firstExpression);
  return starts.length > 0 ? starts : ['.'];
}

/**
 * Checks recursive deletes.
 *
 * @param {Segment} segment - A simple command.
 * @returns {string | null} Reason, or null.
 */
function checkRecursiveDelete(segment) {
  const name = programName(segment);
  const words = segment.argv.slice(1);
  let targets = [];
  if (name === 'rm' && isRecursive(words)) {
    targets = operands(words);
    if (targets.length === 0) {
      return 'rm -r with targets from stdin (xargs) is blocked. Name the folders: only temp, dist, .next and coverage may be deleted.';
    }
  } else if (name === 'find') {
    targets = findDeleteTargets(words);
  }
  const bad = targets.find((target) => !isSafeDeleteTarget(target));
  return bad === undefined
    ? null
    : `Recursive delete of "${bad}" is blocked. Only folders named temp, tmp, dist, .next, coverage (and other build output) may be deleted. Use \`rush purge\`/\`rush rebuild\` for a clean build.`;
}

/**
 * Reads the folder flags of `cp`, `install` and `mv` (`-t DIR`, `--target-directory DIR`).
 *
 * @param {string[]} words - Arguments.
 * @returns {string[]} The target folders.
 */
function targetDirectories(words) {
  const found = [];
  for (const [index, word] of words.entries()) {
    if (word === '-t' || word === '--target-directory' || /^-[a-zA-Z]*t$/.test(word)) {
      found.push(words[index + 1] ?? '');
    } else if (word.startsWith('--target-directory=')) {
      found.push(word.slice('--target-directory='.length));
    } else if (/^-t./.test(word)) {
      found.push(word.slice(2));
    }
  }
  return found;
}

/**
 * Tells whether `ln` makes a symbolic link.
 *
 * @param {string[]} words - Arguments.
 * @returns {boolean} True for -s or --symbolic.
 */
function isSymbolicLink(words) {
  return words.some((word) => word === '--symbolic' || /^-[a-zA-Z]*s[a-zA-Z]*$/.test(word));
}

/**
 * Tells whether `cp` makes hard links (`-l`, `--link`, a short cluster such as `-al`; `-L` follows links).
 *
 * @param {string[]} words - Arguments.
 * @returns {boolean} True when cp links instead of copying.
 */
function copiesByLink(words) {
  return words.some((word) => word === '--link' || /^-[a-zA-Z]*l[a-zA-Z]*$/.test(word));
}

/**
 * Checks the source of a link. A link to a gate file lets a later write through the link change the
 * gate file, and the write names only the link. A symbolic link source is read from the link's own
 * folder, so the word is also tried from there.
 *
 * @param {Segment} segment - A simple command.
 * @param {PathScope} scope - Scope.
 * @returns {string | null} Reason, or null.
 */
function checkLinkSources(segment, scope) {
  const name = programName(segment);
  const words = segment.argv.slice(1);
  const makesLink = name === 'ln' || (name === 'cp' && copiesByLink(words));
  if (!makesLink) {
    return null;
  }
  const folders = targetDirectories(words);
  const names = operands(words);
  const destination = names.at(-1) ?? '';
  const linkFolders = [...folders, path.posix.dirname(destination), destination].filter(
    (folder) => folder !== '',
  );
  for (const source of names) {
    const forms = [source];
    if (name === 'ln' && isSymbolicLink(words) && !path.isAbsolute(source)) {
      forms.push(...linkFolders.map((folder) => path.posix.join(folder, source)));
    }
    for (const form of forms) {
      const hit = gateHitForWord(form, scope);
      if (hit !== null) {
        return `This command links ${hit.relative}, which is a gate file (${hit.why}). A write through the link changes the gate file. ${unlockText()}`;
      }
    }
  }
  return null;
}

/**
 * Collects the words a command writes to (files it changes).
 *
 * @param {Segment} segment - A simple command.
 * @returns {string[]} Write targets.
 */
function writeTargets(segment) {
  const name = programName(segment);
  const words = segment.argv.slice(1);
  const found = segment.redirects
    .filter(
      (redirect) =>
        /^(?:&?>>?|>\||<>)$/.test(redirect.op) ||
        (redirect.op === '>&' && !/^\d+$|^-$/.test(redirect.target)),
    )
    .map((redirect) => redirect.target);
  if (ALL_ARGUMENT_WRITERS.has(name)) {
    found.push(...operands(words), ...targetDirectories(words));
  } else if (LAST_ARGUMENT_WRITERS.has(name)) {
    found.push(operands(words).at(-1) ?? '', ...targetDirectories(words));
  } else if (name === 'ln') {
    found.push(
      ...(isSymbolicLink(words) ? [operands(words).at(-1) ?? ''] : operands(words)),
      ...targetDirectories(words),
    );
  } else if (
    ['sed', 'perl', 'ruby'].includes(name) &&
    words.some((word) => /^-[a-zA-Z]*i/.test(word) || word.startsWith('--in-place'))
  ) {
    found.push(...operands(words));
  } else if (
    ['awk', 'gawk', 'mawk'].includes(name) &&
    (words.includes('inplace') || words.some((word) => word.startsWith('--in-place')))
  ) {
    found.push(...operands(words));
  } else if (name === 'dd') {
    found.push(...words.filter((word) => word.startsWith('of=')).map((word) => word.slice(3)));
  } else if (name === 'curl' || name === 'wget') {
    found.push(...downloadTargets(words));
  }
  return found;
}

/**
 * Reads the output file of `curl` and `wget` (`-o f`, `-of`, `--output f`, `--output=f`).
 *
 * @param {string[]} words - Arguments.
 * @returns {string[]} Output files.
 */
function downloadTargets(words) {
  const found = [];
  for (const [index, word] of words.entries()) {
    if (['-o', '--output', '-O', '--output-document'].includes(word)) {
      found.push(words[index + 1] ?? '');
    } else if (/^--(?:output|output-document)=/.test(word)) {
      found.push(word.slice(word.indexOf('=') + 1));
    } else if (/^-[oO]./.test(word)) {
      found.push(word.slice(2));
    }
  }
  return found;
}

/**
 * Looks in code text for a gate path next to a write word.
 *
 * @param {string} code - Interpreter code or shell script text.
 * @param {PathScope} scope - Scope.
 * @param {string} [interpreter] - Program name when an interpreter (not awk, not a shell) runs the code.
 * @returns {{ relative: string, why: string } | null} The first gate path in the code, or null.
 */
function gatePathInCode(code, scope, interpreter) {
  const writes = interpreter === undefined ? WRITE_WORDS.test(code) : canWrite(code, interpreter);
  if (!writes) {
    return null;
  }
  for (const word of code.match(WORD_IN_CODE) ?? []) {
    const looksLikePath = (word.includes('/') || word.includes('.')) && /[A-Za-z0-9_]/.test(word);
    const hit = looksLikePath ? gateHitForWord(word, scope) : null;
    if (hit !== null) {
      return hit;
    }
  }
  return null;
}

/**
 * Collects the code an interpreter or shell runs: inline code, here-documents, pipes and a script file.
 *
 * @param {Segment} segment - A simple command.
 * @param {PathScope} scope - Scope.
 * @returns {string[]} Code texts.
 */
function codeOf(segment, scope) {
  const name = programName(segment);
  const isInterpreter = INTERPRETER_NAME.test(name);
  if (!isInterpreter && !SHELL_NAME.test(name)) {
    return [];
  }
  const words = segment.argv.slice(1);
  const texts = [];
  for (const [index, word] of words.entries()) {
    if (isInterpreter && CODE_FLAG.test(word)) {
      texts.push(words[index + 1] ?? '');
    }
  }
  const isAwk = ['awk', 'gawk', 'mawk'].includes(name);
  const operandWords = operands(words);
  if (isAwk && texts.length === 0 && operandWords[0] !== undefined) {
    texts.push(operandWords[0]);
  }
  const script = isAwk ? undefined : operandWords.find((word) => word !== '-');
  if (texts.length === 0 && script !== undefined) {
    texts.push(scriptText(script, scope));
  }
  if (texts.length === 0 || script === undefined) {
    texts.push(...segment.stdinTexts);
  }
  return texts.filter((text) => text !== '');
}

/**
 * Reads a script file that a command runs. A gate file, build output and big files are skipped.
 *
 * @param {string} file - Script path from the command.
 * @param {PathScope} scope - Scope.
 * @returns {string} The text, or an empty string.
 */
function scriptText(file, scope) {
  for (const cwd of scope.cwds) {
    const absolute = path.resolve(cwd, file);
    const relative = path.relative(scope.root, absolute).split(path.sep).join('/');
    if (
      relative.startsWith('..') ||
      findGate(relative) !== null ||
      SCRIPT_SKIPPED_FOLDERS.test(relative) ||
      fileSize(absolute) > MAX_SCRIPT_BYTES
    ) {
      continue;
    }
    const text = readText(absolute);
    if (text !== null) {
      return text;
    }
  }
  return '';
}

/**
 * Checks code that an interpreter or shell runs for writes to gate files.
 *
 * @param {Segment} segment - A simple command.
 * @param {PathScope} scope - Scope.
 * @returns {string | null} Reason, or null.
 */
function checkCode(segment, scope) {
  const name = programName(segment);
  const interpreter = INTERPRETER_NAME.test(name) && !/awk$/.test(name) ? name : undefined;
  for (const code of codeOf(segment, scope)) {
    const hit = gatePathInCode(code, scope, interpreter);
    if (hit !== null) {
      return `This script or inline code may write ${hit.relative}, which is a gate file (${hit.why}). ${unlockText()}`;
    }
  }
  return null;
}

/**
 * Checks `sed` scripts that write files (`w file`, `s/a/b/w file`).
 *
 * @param {Segment} segment - A simple command.
 * @param {PathScope} scope - Scope.
 * @returns {string | null} Reason, or null.
 */
function checkSedWrite(segment, scope) {
  if (programName(segment) !== 'sed') {
    return null;
  }
  for (const word of segment.argv.slice(1)) {
    const target = /(?:^|[;{}\s/])w\s*(\S+)$/.exec(word)?.[1];
    const hit = target === undefined ? null : gateHitForWord(target, scope);
    if (hit !== null) {
      return `This sed script writes ${hit.relative}, which is a gate file (${hit.why}). ${unlockText()}`;
    }
  }
  return null;
}

/**
 * Checks commands that change a gate file or a hook (redirects, sed -i, cp, mv, rm, tee, chmod,
 * patch, tar, interpreters).
 *
 * @param {Segment} segment - A simple command.
 * @param {GuardContext} context - Guard context.
 * @returns {string | null} Reason, or null.
 */
function checkGateWrites(segment, context) {
  const { scope } = context;
  if (scope === undefined) {
    return null;
  }
  for (const target of writeTargets(segment)) {
    const hit = gateHitForWord(target, scope);
    if (hit !== null) {
      return `This command writes ${hit.relative}, which is a gate file (${hit.why}). ${unlockText()}`;
    }
  }
  return (
    checkLinkSources(segment, scope) ??
    checkCode(segment, scope) ??
    checkSedWrite(segment, scope) ??
    checkIncomingFiles(segment, scope)
  );
}

/**
 * Checks file-system commands.
 *
 * @param {Segment} segment - A simple command.
 * @param {GuardContext} context - Guard context.
 * @returns {string | null} A reason to block, or null.
 */
export function checkFiles(segment, context) {
  return checkRecursiveDelete(segment) ?? checkGateWrites(segment, context);
}

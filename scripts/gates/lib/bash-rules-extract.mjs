// guard-bash rules for archive and copy tools that the file rules do not cover: `ditto`, `cpio`,
// `pax`, and the other spellings and option forms of `tar` and `unzip`. A write into the repo root,
// `.claude`, `.claude/state` or any other folder that holds a gate file is blocked, because the
// write can plant a fake `.claude/state/last-verify.json`. The members of a stream are unknown, so
// the destination folder is the only thing the guard can check.
import { gateHitForWord } from './bash-paths.mjs';
import { checkIncomingFiles } from './bash-rules-vcs.mjs';
import { unlockText } from './gate-list.mjs';
import { programName } from './shell-parse.mjs';

/**
 * @typedef {import('./shell-parse.mjs').Segment} Segment
 * @typedef {import('./bash-paths.mjs').PathScope} PathScope
 * @typedef {import('./bash-rules-git.mjs').GuardContext} GuardContext
 * @typedef {{ letter: string, value: string | null }} ClusterEntry
 * @typedef {{ short: string, long: string[] }} OptionSpec
 */

const TAR_ALIASES = /^(?:gtar|gnutar|bsdtar)$/;
const CPIO_NAMES = /^(?:cpio|bsdcpio|gcpio)$/;
const TAR_ARGUMENT_LETTERS = 'CfTXb';
const UNZIP_FOLDER_FLAG = /^-([a-zA-Z]*?)d(.*)$/;

/**
 * Reads one cluster of short options (`-xzvf`, `-idD dir`, `-C.claude`) the way getopt does. A
 * letter that takes an argument uses the rest of the word, or else the next word.
 *
 * @param {string[]} words - All words.
 * @param {number} index - Index of the cluster word.
 * @param {string} takesArgument - Letters that take an argument.
 * @returns {{ entries: ClusterEntry[], next: number }} The letters with their values, and the index of the last word used.
 */
function splitCluster(words, index, takesArgument) {
  const letters = (words[index] ?? '').replace(/^-/, '');
  /** @type {ClusterEntry[]} */
  const entries = [];
  let next = index;
  for (const [position, letter] of [...letters].entries()) {
    if (!takesArgument.includes(letter)) {
      entries.push({ letter, value: null });
      continue;
    }
    const attached = letters.slice(position + 1);
    if (attached === '') {
      next += 1;
      entries.push({ letter, value: words[next] ?? '' });
    } else {
      entries.push({ letter, value: attached });
    }
    break;
  }
  return { entries, next };
}

/**
 * Reads one long option (`--directory=dir`, `--directory dir`, `--extract`).
 *
 * @param {string[]} words - All words.
 * @param {number} index - Index of the option word.
 * @param {OptionSpec} spec - Long names that take an argument.
 * @returns {{ name: string, value: string | null, next: number }} The name with `--`, the value (null for a flag), and the index of the last word used.
 */
function readLongOption(words, index, spec) {
  const [name = '', ...rest] = (words[index] ?? '').split('=');
  if (rest.length > 0) {
    return { name, value: rest.join('='), next: index };
  }
  if (spec.long.includes(name.slice(2))) {
    return { name, value: words[index + 1] ?? '', next: index + 1 };
  }
  return { name, value: null, next: index };
}

/**
 * Reads one option word: a long option or a cluster of short options.
 *
 * @param {string[]} words - All words.
 * @param {number} index - Index of the option word.
 * @param {OptionSpec} spec - Short letters and long names that take an argument.
 * @returns {{ entries: { name: string, value: string | null }[], next: number }} The options (a letter or a `--name`, with a value or null), and the index of the last word used.
 */
function readOptionWord(words, index, spec) {
  if ((words[index] ?? '').startsWith('--')) {
    const { name, value, next } = readLongOption(words, index, spec);
    return { entries: [{ name, value }], next };
  }
  const { entries, next } = splitCluster(words, index, spec.short);
  return { entries: entries.map(({ letter, value }) => ({ name: letter, value })), next };
}

/**
 * Reads the options of a command.
 *
 * @param {string[]} words - Arguments (without the program name).
 * @param {OptionSpec} spec - Short letters and long names that take an argument.
 * @returns {{ flags: Set<string>, values: Map<string, string[]>, positional: string[] }} Flags (letters and `--names`), option values, and the other words.
 */
function readOptions(words, spec) {
  /** @type {Set<string>} */
  const flags = new Set();
  /** @type {Map<string, string[]>} */
  const values = new Map();
  /** @type {string[]} */
  const positional = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? '';
    if (word === '--') {
      positional.push(...words.slice(index + 1));
      break;
    }
    if (!word.startsWith('-') || word === '-') {
      positional.push(word);
      continue;
    }
    const { entries, next } = readOptionWord(words, index, spec);
    for (const { name, value } of entries) {
      flags.add(name);
      if (value !== null) {
        values.set(name, [...(values.get(name) ?? []), value]);
      }
    }
    index = next;
  }
  return { flags, values, positional };
}

/**
 * Lists the values of an option under any of its names.
 *
 * @param {Map<string, string[]>} values - Option values.
 * @param {string[]} keys - Names of the option, such as `D` and `--directory`.
 * @returns {string[]} The values.
 */
function valuesOf(values, keys) {
  return keys.flatMap((key) => values.get(key) ?? []);
}

/**
 * Finds the first destination word that names a gate file or a folder that holds gate files.
 *
 * @param {string[]} targets - Destination words.
 * @param {PathScope} scope - Scope.
 * @returns {{ relative: string, why: string } | null} The hit, or null.
 */
function firstHit(targets, scope) {
  for (const target of targets) {
    const hit = target === '' ? null : gateHitForWord(target, scope);
    if (hit !== null) {
      return hit;
    }
  }
  return null;
}

/**
 * Builds the message for a blocked write.
 *
 * @param {string} name - Program name.
 * @param {{ relative: string, why: string }} hit - The gate hit.
 * @returns {string} The reason.
 */
function blockedText(name, hit) {
  return `${name} writes into ${hit.relative}, which is a gate file or holds gate files (${hit.why}). A write into the repo root or .claude can plant a fake .claude/state/last-verify.json. Extract into temp/ and review the files. ${unlockText()}`;
}

/**
 * Checks `ditto`. The last operand is the destination, and `ditto` always copies folders.
 *
 * @param {string[]} words - Arguments.
 * @param {PathScope} scope - Scope.
 * @returns {string | null} Reason, or null.
 */
function checkDitto(words, scope) {
  const { positional } = readOptions(words, { short: '', long: [] });
  const hit = firstHit([positional.at(-1) ?? ''], scope);
  return hit === null ? null : blockedText('ditto', hit);
}

/**
 * Lists the folders a `cpio` command writes into: the extract folder (`-D`, or the working
 * folder), the pass-through folder (the last operand), or the output archive (`-O`).
 *
 * @param {string[]} words - Arguments.
 * @returns {string[]} The destination words.
 */
function cpioTargets(words) {
  const { flags, values, positional } = readOptions(words, {
    short: 'CDEFHIMOR',
    long: ['directory', 'file'],
  });
  const folders = valuesOf(values, ['D', '--directory']);
  if (flags.has('i') || flags.has('--extract')) {
    return folders.length > 0 ? folders : ['.'];
  }
  if (flags.has('p') || flags.has('--pass-through')) {
    return [...folders, positional.at(-1) ?? ''];
  }
  return flags.has('o') || flags.has('--create') ? valuesOf(values, ['O', '--file']) : [];
}

/**
 * Checks `cpio` in extract, pass-through and create mode.
 *
 * @param {string} name - Program name.
 * @param {string[]} words - Arguments.
 * @param {PathScope} scope - Scope.
 * @returns {string | null} Reason, or null.
 */
function checkCpio(name, words, scope) {
  const hit = firstHit(cpioTargets(words), scope);
  return hit === null ? null : blockedText(name, hit);
}

/**
 * Reads the replacement text of the `-s` expressions of `pax` (`-s ,^,.claude/state/,`).
 *
 * @param {string[]} expressions - The `-s` values.
 * @returns {string[]} The replacement texts, without `&` and what follows it.
 */
function paxReplacements(expressions) {
  return expressions
    .map((expression) => (expression.split(expression[0] ?? '/')[2] ?? '').replace(/&.*$/, ''))
    .filter((replacement) => replacement !== '');
}

/**
 * Lists the folders a `pax` command writes into. Read mode extracts into the working folder, copy
 * mode (`-rw`) writes into the last operand, and write mode writes the `-f` archive. A `-s`
 * replacement can move a member into another folder.
 *
 * @param {string[]} words - Arguments.
 * @returns {string[]} The destination words.
 */
function paxTargets(words) {
  const { flags, values, positional } = readOptions(words, { short: 'bBEfGopsTUx', long: [] });
  const reads = flags.has('r');
  const writes = flags.has('w');
  const replacements = paxReplacements(values.get('s') ?? []);
  if (reads && writes) {
    return [positional.at(-1) ?? '', ...replacements];
  }
  if (reads) {
    return ['.', ...replacements];
  }
  return writes ? (values.get('f') ?? []) : [];
}

/**
 * Checks `pax` in read, copy and write mode.
 *
 * @param {string[]} words - Arguments.
 * @param {PathScope} scope - Scope.
 * @returns {string | null} Reason, or null.
 */
function checkPax(words, scope) {
  const hit = firstHit(paxTargets(words), scope);
  return hit === null ? null : blockedText('pax', hit);
}

/**
 * Tells whether a word of `tar` is a cluster of short options (`-xzf`, or `xzf` as the first word).
 *
 * @param {string} word - A word.
 * @param {number} index - Index of the word.
 * @returns {boolean} True for a cluster.
 */
function isTarCluster(word, index) {
  const dashed = word.startsWith('-') && !word.startsWith('--') && word.length > 1;
  return dashed || (index === 0 && /^[a-zA-Z]+$/.test(word));
}

/**
 * Turns the letters of a `tar` cluster into plain words. The archive `-f -` (stdin) is dropped.
 *
 * @param {ClusterEntry[]} entries - The letters with their values.
 * @returns {string[]} One word for each option and one for each value.
 */
function plainTarOptions(entries) {
  return entries
    .filter(({ letter, value }) => !(letter === 'f' && value === '-'))
    .flatMap(({ letter, value }) => (value === null ? [`-${letter}`] : [`-${letter}`, value]));
}

/**
 * Rewrites the words of `tar` into one option for each word (`-xCf . a` becomes `-x -C . -f a`).
 * An archive named `-` (stdin, `-f -` or `--file=-`) is dropped, so the archive reader treats the members as unknown.
 *
 * @param {string[]} words - Arguments.
 * @returns {string[]} The words in the plain form.
 */
function canonicalTarWords(words) {
  /** @type {string[]} */
  const result = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? '';
    if (word === '--') {
      result.push(...words.slice(index));
      break;
    }
    if (word === '--file=-' || (word === '--file' && words[index + 1] === '-')) {
      index += word === '--file' ? 1 : 0;
      continue;
    }
    if (isTarCluster(word, index)) {
      const { entries, next } = splitCluster(words, index, TAR_ARGUMENT_LETTERS);
      result.push(...plainTarOptions(entries));
      index = next;
    } else {
      result.push(word);
    }
  }
  return result;
}

/**
 * Rewrites the words of `unzip` so that `-ddir` and `-qddir` read as `-d dir`.
 *
 * @param {string[]} words - Arguments.
 * @returns {string[]} The words in the plain form.
 */
function canonicalUnzipWords(words) {
  /** @type {string[]} */
  const result = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? '';
    const match = word.startsWith('--') ? null : UNZIP_FOLDER_FLAG.exec(word);
    if (match === null) {
      result.push(word);
      continue;
    }
    result.push(...[...(match[1] ?? '')].map((letter) => `-${letter}`), '-d');
    if (match[2] === '') {
      index += 1;
      result.push(words[index] ?? '');
    } else {
      result.push(match[2] ?? '');
    }
  }
  return result;
}

/**
 * Checks the spellings of `tar` (`gtar`, `bsdtar`) and the option forms (`-C.claude`, `-xCf . a`,
 * `-f -`, `-d.claude`) that the archive rule in bash-rules-vcs.mjs does not read. The words are
 * rewritten to the plain form, and the archive rule runs on the result.
 *
 * @param {Segment} segment - A simple command.
 * @param {string} name - Program name.
 * @param {PathScope} scope - Scope.
 * @returns {string | null} Reason, or null.
 */
function checkArchive(segment, name, scope) {
  const isTar = name === 'tar' || TAR_ALIASES.test(name);
  if (!isTar && name !== 'unzip') {
    return null;
  }
  const program = isTar ? 'tar' : 'unzip';
  const words = segment.argv.slice(1);
  const canonical = isTar ? canonicalTarWords(words) : canonicalUnzipWords(words);
  if (name === program && canonical.join('\0') === words.join('\0')) {
    return null;
  }
  return checkIncomingFiles({ ...segment, argv: [program, ...canonical] }, scope);
}

/**
 * Checks `ditto`, `cpio`, `pax` and the extra forms of `tar` and `unzip`.
 *
 * @param {Segment} segment - A simple command.
 * @param {GuardContext} context - Guard context.
 * @returns {string | null} A reason to block, or null.
 */
export function checkExtractors(segment, context) {
  const { scope } = context;
  if (scope === undefined) {
    return null;
  }
  const name = programName(segment);
  const words = segment.argv.slice(1);
  if (name === 'ditto') {
    return checkDitto(words, scope);
  }
  if (CPIO_NAMES.test(name)) {
    return checkCpio(name, words, scope);
  }
  if (name === 'pax') {
    return checkPax(words, scope);
  }
  return checkArchive(segment, name, scope);
}

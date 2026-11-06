// Doc lint: fail when a Markdown doc names a path or a Rush command that does not exist.
//
// Scan: tracked *.md files (git ls-files), except the history and tool folders in isExcluded.
// A file in docs/designs/ is scanned only when its front matter has `status: implemented`.
//
// Check 1: a relative Markdown link points to a file or folder of the repo.
// Check 2: an inline code span that starts with a top-level entry of the repo names a real path.
// Check 3: `rush <cmd>` and `install-run-rush.js <cmd>` use a Rush built-in or a command of
//          common/config/rush/command-line.json.
//
// A path "exists" when git tracks it or when it is a new file that git does not ignore.
// Skip one line: put <!-- doc-lint-ignore-next-line --> on the line above it.
// Run from the repo root: node tooling/repo-checks/scripts/doc-lint.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';

import { isGithubActions } from './lib/doc-lint.config.mjs';
import { readRepositoryFile } from './lib/fs-io.mjs';
import { parseJsonc } from './lib/jsonc.mjs';

export const RUSH_BUILT_INS = [
  'add',
  'build',
  'change',
  'check',
  'deploy',
  'init',
  'init-autoinstaller',
  'install',
  'install-autoinstaller',
  'link',
  'list',
  'publish',
  'purge',
  'rebuild',
  'remove',
  'scan',
  'setup',
  'unlink',
  'update',
  'update-autoinstaller',
  'upgrade-interactive',
  'version',
];

export const COMMAND_LINE_FILE = 'common/config/rush/command-line.json';
export const IGNORE_MARKER = '<!-- doc-lint-ignore-next-line -->';

// Characters and text that mark a placeholder or a pattern, not a real path.
const PLACEHOLDER = /[<>*{}$\s]|\.\.\./;
const FENCE = /^\s*(`{3,}|~{3,})/;
const CODE_SPAN = /(`+)(.+?)\1/g;
const INLINE_LINK = /\[[^\]]*\]\(([^)]*)\)/g;
const REFERENCE_LINK = /^ {0,3}\[[^\]]+\]:(.*)$/;
const RUSH_COMMAND = /(?:^|[^\w./-])(?:rush|install-run-rush\.js)\s+([a-z][\w:-]*)/g;
const LINE_SUFFIX = /:\d+$/;
const URL_SCHEME = /^[a-z][\w+.-]*:/i;

/** True when the file is history or tool output and doc lint never scans it. */
export function isExcluded(file) {
  return (
    file.startsWith('docs/adr/') ||
    file.startsWith('evals/reviewer/cases/') ||
    file.startsWith('common/') ||
    file.split('/').includes('node_modules') ||
    posix.basename(file) === 'CHANGELOG.md'
  );
}

/** Return the `status` value of the YAML front matter, or '' when there is none. */
export function frontMatterStatus(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (match === null) return '';
  const status = /^status:\s*['"]?([\w-]+)/m.exec(match[1]);
  return status === null ? '' : status[1];
}

/** Return the Rush command names: built-ins plus the commands of command-line.json. */
export function rushCommands(commandLineText) {
  const config = parseJsonc(commandLineText);
  const custom = (config.commands ?? []).map((command) => command.name);
  return new Set([...RUSH_BUILT_INS, ...custom]);
}

/** Build the set of known files and folders from a list of repo file paths. */
export function knownPaths(files) {
  const known = new Set();
  for (const file of files) {
    known.add(file);
    let folder = posix.dirname(file);
    while (folder !== '.' && !known.has(folder)) {
      known.add(folder);
      folder = posix.dirname(folder);
    }
  }
  return known;
}

// Top-level entries: each folder (with "/") and each root file.
function topLevelEntries(known) {
  return [...known].filter((entry) => !entry.includes('/'));
}

// Link text inside "(...)": the target, then an optional title. The target can sit in <...>.
function linkDestination(inside) {
  return (inside.trim().split(/\s/)[0] ?? '').replace(/^<(.*)>$/, '$1');
}

// The repo path of a link target, or '' when the link is external or an anchor only.
function linkTarget(raw, file) {
  if (raw === '' || raw.startsWith('#') || URL_SCHEME.test(raw)) return '';
  const bare = raw.replace(/[#?].*$/, '');
  if (bare === '') return '';
  let decoded = bare;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    // Keep the raw text. The existence check reports it.
  }
  const joined = decoded.startsWith('/')
    ? decoded.slice(1)
    : posix.join(posix.dirname(file), decoded);
  return posix.normalize(joined).replace(/\/$/, '');
}

function linkFindings(prose, file, known) {
  const targets = [...prose.matchAll(INLINE_LINK)].map((match) => linkDestination(match[1]));
  const reference = REFERENCE_LINK.exec(prose);
  if (reference !== null) targets.push(linkDestination(reference[1]));
  const findings = [];
  for (const raw of targets) {
    const target = linkTarget(raw, file);
    if (target !== '' && !known.has(target)) {
      findings.push({ message: `broken link "${raw}": ${target} does not exist` });
    }
  }
  return findings;
}

// The repo path that a code span names, or '' when the span is not a repo path.
// A trailing ":line" or ":line:col" is not part of the path.
function codePath(span, topLevel) {
  if (PLACEHOLDER.test(span)) return '';
  const bare = span.replace(LINE_SUFFIX, '').replace(LINE_SUFFIX, '').replace(/#.*$/, '');
  if (!topLevel.has(bare.split('/')[0])) return '';
  return posix.normalize(bare).replace(/\/$/, '');
}

function commandFindings(code, commands) {
  const findings = [];
  for (const match of code.matchAll(RUSH_COMMAND)) {
    if (!commands.has(match[1])) {
      findings.push({ message: `unknown Rush command "${match[1]}"` });
    }
  }
  return findings;
}

function spanFindings(spans, context) {
  const findings = [];
  for (const span of spans) {
    const target = codePath(span.trim(), context.topLevel);
    // A doc in a project folder can name a path relative to its own folder.
    const local = posix.join(posix.dirname(context.file), target);
    if (target !== '' && !context.known.has(target) && !context.known.has(local)) {
      findings.push({ message: `path "${span.trim()}" does not exist`, path: target });
    }
    findings.push(...commandFindings(span, context.commands));
  }
  return findings;
}

// Findings of one line. `state.fence` holds the open fence marker, or '' outside a fence.
function lineFindings(line, state, context) {
  const fenceMatch = FENCE.exec(line);
  if (state.fence === '') {
    if (fenceMatch !== null) {
      state.fence = fenceMatch[1];
      return [];
    }
    const spans = [...line.matchAll(CODE_SPAN)].map((match) => match[2]);
    const prose = line.replaceAll(CODE_SPAN, ' ');
    return [...linkFindings(prose, context.file, context.known), ...spanFindings(spans, context)];
  }
  const closes =
    fenceMatch !== null &&
    fenceMatch[1][0] === state.fence[0] &&
    fenceMatch[1].length >= state.fence.length;
  if (closes) {
    state.fence = '';
    return [];
  }
  return commandFindings(line, context.commands);
}

/**
 * Check one doc. Context: { known: Set of repo paths, commands: Set of Rush command names }.
 * An inline code path passes when it exists from the repo root or from the folder of the doc.
 * Return findings { line, message, path? }. `path` is set for inline code paths only.
 */
export function checkDocument(file, text, context) {
  const full = { ...context, file, topLevel: new Set(topLevelEntries(context.known)) };
  const state = { fence: '' };
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const found = lineFindings(line, state, full);
    const skipped = index > 0 && lines[index - 1].includes(IGNORE_MARKER);
    if (!skipped) for (const finding of found) findings.push({ line: index + 1, ...finding });
  }
  return findings;
}

/**
 * Decide how to handle one Markdown file. Return { scan: boolean, finding?: string }.
 * Designs need a `status` in their front matter. Only implemented designs are scanned.
 */
export function scanPolicy(file, text) {
  if (isExcluded(file)) return { scan: false };
  if (!file.startsWith('docs/designs/')) return { scan: true };
  const status = frontMatterStatus(text);
  if (status === '') return { scan: false, finding: 'design has no status front matter' };
  return { scan: status === 'implemented' };
}

function gitList(root, args) {
  const out = execFileSync('git', ['ls-files', '-z', ...args], { cwd: root, encoding: 'utf8' });
  return out.split('\0').filter((name) => name !== '');
}

// Tracked *.md files. Symbolic links (AGENTS.md -> CLAUDE.md) are skipped: their target is scanned.
function markdownFiles(root) {
  return gitList(root, ['--stage', '--', '*.md'])
    .map((entry) => entry.split('\t'))
    .filter(([info]) => !info.startsWith('120000 '))
    .map(([, file]) => file);
}

// Paths that git ignores (local files such as .claude/settings.local.json).
function ignoredPaths(root, paths) {
  if (paths.length === 0) return new Set();
  const result = spawnSync('git', ['check-ignore', '--no-index', '-z', '--stdin'], {
    cwd: root,
    encoding: 'utf8',
    input: paths.join('\0'),
  });
  return new Set(result.stdout.split('\0').filter((name) => name !== ''));
}

/** Format one finding. GitHub Actions gets an annotation. */
export function formatFinding(finding, github) {
  if (!github) return `${finding.file}:${finding.line}: ${finding.message}`;
  const message = finding.message
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
  return `::error file=${finding.file},line=${finding.line}::${message}`;
}

/** Lint all docs under root. Return the list of findings { file, line, message }. */
export function lintRepository(root) {
  const deleted = new Set(gitList(root, ['--deleted']));
  const files = gitList(root, ['--cached', '--others', '--exclude-standard']).filter(
    (file) => !deleted.has(file),
  );
  const context = {
    known: knownPaths(files),
    commands: rushCommands(readRepositoryFile(root, COMMAND_LINE_FILE)),
  };
  const documents = markdownFiles(root).filter((file) => !deleted.has(file));
  const findings = [];
  for (const file of documents) {
    const text = readRepositoryFile(root, file);
    const policy = scanPolicy(file, text);
    if (policy.finding !== undefined) findings.push({ file, line: 1, message: policy.finding });
    if (policy.scan) {
      for (const finding of checkDocument(file, text, context)) findings.push({ file, ...finding });
    }
  }
  const ignored = ignoredPaths(
    root,
    findings.filter((finding) => finding.path !== undefined).map((finding) => finding.path),
  );
  return findings
    .filter((finding) => finding.path === undefined || !ignored.has(finding.path))
    .map(({ file, line, message }) => ({ file, line, message }));
}

export function main() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const findings = lintRepository(root);
  if (findings.length > 0) {
    const github = isGithubActions();
    const lines = findings.map((finding) => formatFinding(finding, github));
    process.stderr.write(`${lines.join('\n')}\ndoc-lint: ${findings.length} findings\n`);
    return 1;
  }
  process.stdout.write('doc-lint: ok\n');
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}

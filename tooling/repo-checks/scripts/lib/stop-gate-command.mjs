// Shell command parsing for the stop gate: find a Rush `test`, `typecheck` or `verify` run in a
// Bash command, and work out the Rush projects that its selectors cover.
//
// The PostToolUse hook fires only when the whole command exits 0. The hook credits a Rush run only
// when that exit code proves the Rush run passed: the Rush part must run, and it must be the last
// command. A pipe (`| tail`), `||`, `;`, `&` or `&&` after it gets no credit.
// For a failed command (PostToolUseFailure), the Rush part must run for sure: only `;` can come
// before it, because a failed `cd x &&` also fails the command.

const OPERATORS = ['&&', '||', ';;', '|', ';', '&', '\n'];
const TEST_COMMANDS = ['test', 'verify'];
const SELECTORS = new Map([
  ['--only', 'only'],
  ['-o', 'only'],
  ['--to', 'to'],
  ['-t', 'to'],
  ['--to-except', 'to-except'],
  ['-T', 'to-except'],
  ['--from', 'from'],
  ['-f', 'from'],
  ['--impacted-by', 'impacted-by'],
  ['-i', 'impacted-by'],
  ['--impacted-by-except', 'impacted-by-except'],
  ['-I', 'impacted-by-except'],
]);
// A word that starts like a selector but is not one of SELECTORS (for example `-t=x`, `-tx` or
// `--to-version-policy`) makes the run cover nothing.
const SELECTOR_LIKE = /^(-[tofiTI]|--(to|from|only|impacted))/;

/**
 * @typedef {{ type: 'word', value: string } | { type: 'op', value: string }} Token
 * @typedef {{ kind: string, value: string }} Selector
 * @typedef {{ command: string, selectors: Selector[] }} RushRun
 * @typedef {{ packageName: string, projectFolder: string, dependencies: string[] }} Project
 */

/**
 * @param {string} text - Command text.
 * @param {number} start - Index of the opening double quote.
 * @returns {{ value: string, end: number }} The unquoted value and the index after the quote.
 */
function readDoubleQuoted(text, start) {
  let value = '';
  let position = start + 1;
  while (position < text.length && text[position] !== '"') {
    if (text.startsWith('\\\n', position)) {
      // Line continuation: POSIX sh removes the backslash and the newline.
      position += 2;
      continue;
    }
    if (text[position] === '\\' && '"\\$`'.includes(text[position + 1] ?? '')) {
      position += 1;
    }
    value += text[position];
    position += 1;
  }
  if (position >= text.length) {
    throw new Error('unclosed double quote');
  }
  return { value, end: position + 1 };
}

/**
 * @param {string} text - Command text.
 * @param {number} position - Index.
 * @returns {string | undefined} The operator that starts at the index.
 */
function operatorAt(text, position) {
  const operator = OPERATORS.find((candidate) => text.startsWith(candidate, position));
  if (operator === '&') {
    // `2>&1` and `&>` are redirections, not a background job.
    const previous = text[position - 1];
    if (previous === '>' || previous === '<' || text[position + 1] === '>') {
      return;
    }
  }
  return operator;
}

/**
 * Reads one part of a word: a quoted string, an escaped character or a plain character.
 *
 * @param {string} text - Command text.
 * @param {number} position - Index of the part.
 * @returns {{ value: string, end: number }} The unquoted value and the index after the part.
 */
function readWordPart(text, position) {
  const character = text[position] ?? '';
  if (character === "'") {
    const close = text.indexOf("'", position + 1);
    if (close === -1) {
      throw new Error('unclosed single quote');
    }
    return { value: text.slice(position + 1, close), end: close + 1 };
  }
  if (character === '"') {
    const quoted = readDoubleQuoted(text, position);
    if (/\$\(|`/.test(quoted.value)) {
      throw new Error('command substitution');
    }
    return quoted;
  }
  if (character === '\\') {
    return { value: text[position + 1] ?? '', end: position + 2 };
  }
  if ('()`'.includes(character) || text.startsWith('$(', position)) {
    throw new Error('subshell or command substitution');
  }
  return { value: character, end: position + 1 };
}

/**
 * @param {string} text - Command text.
 * @param {number} position - Index of a "#" at the start of a word.
 * @returns {number} The index of the end of the line: a comment runs to there.
 */
function commentEnd(text, position) {
  const end = text.indexOf('\n', position);
  return end === -1 ? text.length : end;
}

/**
 * Splits a shell command into words and operators. Quotes and backslashes follow POSIX sh.
 * Command substitution and subshells are not parsed: the function throws for them.
 *
 * @param {string} text - Command text.
 * @returns {Token[]} Tokens.
 */
export function tokenize(text) {
  /** @type {Token[]} */
  const tokens = [];
  /** @type {string[] | undefined} */
  let parts;
  const flush = () => {
    if (parts) {
      tokens.push({ type: 'word', value: parts.join('') });
      parts = undefined;
    }
  };
  let position = 0;
  while (position < text.length) {
    const operator = operatorAt(text, position);
    const character = text[position] ?? '';
    if (text.startsWith('\\\n', position)) {
      // Line continuation: POSIX sh removes the backslash and the newline.
      position += 2;
    } else if (!parts && character === '#') {
      position = commentEnd(text, position);
    } else if (operator) {
      flush();
      tokens.push({ type: 'op', value: operator === '\n' || operator === ';;' ? ';' : operator });
      position += operator.length;
    } else if (character === ' ' || character === '\t') {
      flush();
      position += 1;
    } else {
      const part = readWordPart(text, position);
      parts = [...(parts ?? []), part.value];
      position = part.end;
    }
  }
  flush();
  return tokens;
}

/**
 * @param {Token[]} tokens - Tokens.
 * @returns {{ words: string[], before: string | undefined, after: string | undefined }[]} The
 *   simple commands, each with the operator before and after it.
 */
function segments(tokens) {
  /** @type {{ words: string[], before: string | undefined, after: string | undefined }[]} */
  const result = [{ words: [], before: undefined, after: undefined }];
  for (const token of tokens) {
    const current = result.at(-1);
    if (!current) {
      continue;
    }
    if (token.type === 'op') {
      current.after = token.value;
      result.push({ words: [], before: token.value, after: undefined });
    } else {
      current.words.push(token.value);
    }
  }
  return result.filter((segment) => segment.words.length > 0);
}

/**
 * @param {string[]} words - Words of one simple command.
 * @returns {string[] | undefined} The words after the Rush entry point, or undefined when the
 *   command does not run Rush.
 */
function rushArguments(words) {
  let index = 0;
  while (/^[A-Za-z_]\w*=/.test(words[index] ?? '')) {
    index += 1;
  }
  if (words[index] === 'node') {
    index += 1;
  }
  const entry = words[index] ?? '';
  if (entry === 'rush' || entry.endsWith('install-run-rush.js')) {
    return words.slice(index + 1);
  }
  return;
}

/**
 * @param {string[]} parameters - Words after the Rush command name.
 * @returns {Selector[] | string} The selectors, or the reason that the run gets no credit.
 */
function readSelectors(parameters) {
  /** @type {Selector[]} */
  const selectors = [];
  for (let index = 0; index < parameters.length; index += 1) {
    const word = parameters[index] ?? '';
    if (word === '--help' || word === '-h') {
      return 'the command shows help only';
    }
    const [flag = '', inline] = word.startsWith('--') ? word.split(/=(.*)/s) : [word];
    const kind = SELECTORS.get(flag);
    if (!kind && SELECTOR_LIKE.test(word)) {
      return `unknown selector "${word}"`;
    }
    if (kind) {
      const value = inline ?? parameters[index + 1] ?? '';
      if (inline === undefined) {
        index += 1;
      }
      selectors.push({ kind, value });
    }
  }
  return selectors;
}

/**
 * Finds the Rush runs whose result the command exit code proves.
 *
 * @param {string} command - Bash command.
 * @param {boolean} [failed] - True when the command failed (PostToolUseFailure).
 * @param {string[]} [names] - Rush command names to find. Default: `test` and `verify`.
 * @returns {{ runs: RushRun[], rejected: string[] }} Proven runs, and the reasons for Rush runs
 *   that got no credit.
 */
export function findRushRuns(command, failed = false, names = TEST_COMMANDS) {
  let tokens;
  try {
    tokens = tokenize(command);
  } catch (error) {
    const mentionsRush = [...command.matchAll(/\b(?:rush|install-run-rush\.js)\s+(\w+)\b/g)].some(
      (match) => names.includes(match[1] ?? ''),
    );
    return {
      runs: [],
      rejected: mentionsRush ? [`cannot parse the command (${String(error)})`] : [],
    };
  }
  const parts = segments(tokens);
  /** @type {RushRun[]} */
  const runs = [];
  /** @type {string[]} */
  const rejected = [];
  for (const [index, part] of parts.entries()) {
    const parameters = rushArguments(part.words);
    const name = parameters?.[0];
    if (!parameters || !name || !names.includes(name)) {
      continue;
    }
    const before = parts.slice(0, index + 1).map((segment) => segment.before);
    const allowedBefore = failed ? [undefined, ';'] : [undefined, '&&', ';'];
    const runsForSure = before.every((op) => allowedBefore.includes(op));
    if (!runsForSure || part.after !== undefined) {
      rejected.push(
        `"rush ${name}" must be the last command, with no pipe, "||", ";", "&" or "&&" after it`,
      );
      continue;
    }
    const selectors = readSelectors(parameters.slice(1));
    if (typeof selectors === 'string') {
      rejected.push(selectors);
    } else {
      runs.push({ command: name, selectors });
    }
  }
  return { runs, rejected };
}

/**
 * @param {Project[]} projects - Rush projects.
 * @param {string} start - Package name.
 * @param {(project: Project) => string[]} next - Edges.
 * @returns {Set<string>} Package names reachable from start, start included.
 */
function walk(projects, start, next) {
  const byName = new Map(projects.map((project) => [project.packageName, project]));
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const project = byName.get(queue.pop() ?? '');
    for (const name of project ? next(project) : []) {
      if (!seen.has(name)) {
        seen.add(name);
        queue.push(name);
      }
    }
  }
  return seen;
}

/**
 * Works out the projects that a Rush run covers. No selector covers all projects. A selector with
 * an unknown value (a tag, a git ref, ".") covers nothing, so the gate never gives too much credit.
 *
 * @param {Project[]} projects - Rush projects.
 * @param {Selector[]} selectors - Selectors of the run.
 * @returns {Set<string>} Covered package names.
 */
export function coveredProjects(projects, selectors) {
  if (selectors.length === 0) {
    return new Set(projects.map((project) => project.packageName));
  }
  const names = new Set(projects.map((project) => project.packageName));
  /** @param {Project} project */
  const dependencies = (project) => project.dependencies;
  /** @param {Project} project */
  const dependents = (project) =>
    projects
      .filter((other) => other.dependencies.includes(project.packageName))
      .map((other) => other.packageName);
  const covered = new Set();
  for (const { kind, value } of selectors) {
    if (!names.has(value)) {
      continue;
    }
    /** @type {Set<string>} */
    let selected;
    if (kind === 'only') {
      selected = new Set([value]);
    } else if (kind === 'to' || kind === 'to-except') {
      selected = walk(projects, value, dependencies);
    } else if (kind === 'impacted-by' || kind === 'impacted-by-except') {
      selected = walk(projects, value, dependents);
    } else {
      const down = walk(projects, value, dependents);
      selected = new Set([...down].flatMap((name) => [...walk(projects, name, dependencies)]));
    }
    if (kind.endsWith('-except')) {
      selected.delete(value);
    }
    for (const name of selected) {
      covered.add(name);
    }
  }
  return covered;
}

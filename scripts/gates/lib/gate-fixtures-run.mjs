// Runner logic of scripts/gates/gate-fixtures.mjs. It is pure: it never starts a process and never
// touches a file. The caller gives a context object with the real (or a fake) executor, so the unit
// tests run the whole logic without a worktree.
//
// A fixture is one bad change (or one clean control) with the gate command that must reject it.
// `runFixture` resets the subject repo, applies the setup steps, runs the gate command and judges
// the outcome: the exit code and the text must both match.
import os from 'node:os';
import { stripVTControlCharacters } from 'node:util';

/**
 * @typedef {object} RunSpec
 * @property {string} program - Program. `{main}`, `{worktree}`, `{sample}` and `{base}` are replaced.
 * @property {string[]} [args] - Arguments (same replacements).
 * @property {'main' | 'worktree' | 'sample'} [cwd] - Working folder. Default: the worktree.
 * @property {string | ((variables: Record<string, string>) => string)} [input] - Text for stdin.
 * @property {Record<string, string>} [env] - Extra variables (same replacements).
 * @property {number} [timeoutMs] - Time limit.
 */

/**
 * @typedef {object} Fixture
 * @property {string} id - Short unique id (kebab case).
 * @property {string} row - The row of plan section 11 (or the new rule) that this fixture proves.
 * @property {string} change - The bad change, in one line.
 * @property {string} gate - The gate that must reject it.
 * @property {{ status: number | 'nonzero', match: (RegExp | string)[], absent?: (RegExp | string)[] }} [expected] - The rejection: the exit code and the text (a pattern, or a string that the output must contain). `absent`: text that the output must not contain. For a control, the status is always 0 and `match` is the sentinel that proves the clean change ran. Not needed for a CI-only row.
 * @property {Record<string, unknown>[]} [setup] - Steps that make the bad change in the worktree (see gate-fixtures-worktree.mjs).
 * @property {RunSpec} [run] - The gate command.
 * @property {boolean} [control] - A clean change that the gate must accept (exit 0).
 * @property {boolean} [slow] - Runs only with --slow.
 * @property {boolean} [ciLater] - Only CI can prove it. It is listed and not run.
 * @property {string} [needs] - The rule of another agent that this fixture needs (A, B or C).
 */

export const RESULT = Object.freeze({
  REJECTED: 'PASS (rejected)',
  ACCEPTED: 'PASS (accepted)',
  NOT_REJECTED: 'FAIL (not rejected)',
  CONTROL_REJECTED: 'FAIL (control rejected)',
  SETUP_FAILED: 'FAIL (setup failed)',
  CI_LATER: 'SKIP (CI, later)',
  SLOW: 'SKIP (slow)',
});

const VARIABLE = /\{(main|worktree|sample|base)\}/g;
const DETAIL_LIMIT = 110;
const SECRET_LIKE = /AKIA[0-9A-Z]{16}/g;

/**
 * Replaces the `{main}`, `{worktree}`, `{sample}` and `{base}` markers.
 *
 * @param {string} text - Text with markers.
 * @param {Record<string, string>} variables - Values.
 * @returns {string} The text.
 */
export function fill(text, variables) {
  return text.replaceAll(VARIABLE, (_match, key) => variables[key] ?? '');
}

/**
 * Turns a run spec into the concrete call: markers replaced, the stdin text built.
 *
 * @param {RunSpec} spec - The spec of a fixture.
 * @param {Record<string, string>} variables - Values for the markers.
 * @returns {{ program: string, args: string[], cwd: string, input: string | undefined, env: Record<string, string>, timeoutMs: number | undefined }} The call.
 */
export function resolveRun(spec, variables) {
  const env = Object.fromEntries(
    Object.entries(spec.env ?? {}).map(([key, value]) => [key, fill(value, variables)]),
  );
  const input = typeof spec.input === 'function' ? spec.input(variables) : spec.input;
  return {
    program: fill(spec.program, variables),
    args: (spec.args ?? []).map((word) => fill(word, variables)),
    cwd: variables[spec.cwd ?? 'worktree'] ?? '',
    input,
    env,
    timeoutMs: spec.timeoutMs,
  };
}

/**
 * Makes text safe for the report: no paths of this machine, no secret-like value, one line, cut.
 * The worktree and the repo paths are replaced first, and then the home folder (`~`). The repo is
 * often in the home folder, so the other order would hide the `<repo>` label.
 *
 * @param {string} text - Raw tool output.
 * @param {Record<string, string>} variables - Values of the markers (their paths are hidden).
 * @param {string} [home] - The home folder. Default: `os.homedir()`.
 * @returns {string} One short line.
 */
export function redact(text, variables, home = os.homedir()) {
  let clean = text;
  for (const [key, label] of [
    ['worktree', '<worktree>'],
    ['main', '<repo>'],
  ]) {
    const value = variables[key];
    if (value !== undefined && value !== '') {
      clean = clean.replaceAll(value, label);
    }
  }
  const homeFolder = home.replace(/\/+$/, '');
  if (homeFolder !== '') {
    // Only the whole folder name: `/Users/ann` must not change `/Users/anna`.
    const [first = '', ...rest] = clean.split(homeFolder);
    clean = rest.reduce(
      (text, part) => `${text}${/^[\w.-]/.test(part) ? homeFolder : '~'}${part}`,
      first,
    );
  }
  const flat = stripVTControlCharacters(clean)
    .replaceAll(SECRET_LIKE, '<secret>')
    .replaceAll(/\/(?:private\/)?(?:var|tmp)\/[^\s)]*gate-fixtures-[^/\s]*/g, '<tmp>')
    .replaceAll(/\s+/g, ' ')
    .trim();
  return flat.length > DETAIL_LIMIT ? `${flat.slice(0, DETAIL_LIMIT - 3)}...` : flat;
}

/**
 * Tells whether an exit code is the expected one.
 *
 * @param {number | 'nonzero'} expected - A code, or 'nonzero'.
 * @param {number} status - The exit code.
 * @returns {boolean} True when it matches.
 */
function statusMatches(expected, status) {
  return expected === 'nonzero' ? status !== 0 : status === expected;
}

/**
 * Tells whether a text matches an expectation.
 *
 * @param {RegExp | string} pattern - A pattern, or a string that the text must contain.
 * @param {string} text - The text.
 * @returns {boolean} True when it matches.
 */
function matches(pattern, text) {
  return typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text);
}

/**
 * Finds the first output line that a pattern matches.
 *
 * @param {string} text - Output.
 * @param {RegExp | string} pattern - Pattern.
 * @returns {string} The line, or an empty string.
 */
function firstMatchingLine(text, pattern) {
  return text.split('\n').find((line) => matches(pattern, line)) ?? '';
}

/**
 * Gives what a fixture expects. A control always expects exit 0, plus its sentinel when it has one.
 *
 * @param {Fixture} fixture - The fixture.
 * @returns {{ status: number | 'nonzero', match: (RegExp | string)[], absent: (RegExp | string)[] } | undefined} The expectation, or undefined when a rejection fixture has none.
 */
function wantedFor(fixture) {
  if (fixture.control === true) {
    return {
      status: 0,
      match: fixture.expected?.match ?? [],
      absent: fixture.expected?.absent ?? [],
    };
  }
  return fixture.expected === undefined
    ? undefined
    : { ...fixture.expected, absent: fixture.expected.absent ?? [] };
}

/**
 * Judges the outcome of a gate command.
 *
 * @param {Fixture} fixture - The fixture.
 * @param {{ status: number, stdout: string, stderr: string, started: boolean, timedOut: boolean }} outcome - What the command did.
 * @param {Record<string, string>} variables - Values of the markers (for the redaction).
 * @returns {{ result: string, detail: string }} The result and a one-line detail.
 */
export function evaluate(fixture, outcome, variables) {
  const failure = fixture.control === true ? RESULT.CONTROL_REJECTED : RESULT.NOT_REJECTED;
  const text = `${outcome.stdout}\n${outcome.stderr}`;
  const shown = redact(
    text
      .trim()
      .split('\n')
      .find((line) => line.trim() !== '') ?? '',
    variables,
  );
  if (!outcome.started) {
    return { result: failure, detail: 'the tool did not start. Install it.' };
  }
  if (outcome.timedOut) {
    return { result: failure, detail: 'timed out' };
  }
  const wanted = wantedFor(fixture);
  if (wanted === undefined) {
    return { result: failure, detail: 'the fixture has no expected result' };
  }
  if (!statusMatches(wanted.status, outcome.status)) {
    const code = String(outcome.status);
    return { result: failure, detail: `exit ${code}, expected ${String(wanted.status)}: ${shown}` };
  }
  const missing = wanted.match.find((pattern) => !matches(pattern, text));
  if (missing !== undefined) {
    return {
      result: failure,
      detail: `exit ${String(outcome.status)} but the text has no match for ${String(missing)}: ${shown}`,
    };
  }
  const unwanted = wanted.absent.find((pattern) => matches(pattern, text));
  if (unwanted !== undefined) {
    return {
      result: failure,
      detail: `exit ${String(outcome.status)} but the text has ${String(unwanted)}: ${shown}`,
    };
  }
  if (fixture.control === true) {
    const sentinel = wanted.match[0];
    return {
      result: RESULT.ACCEPTED,
      detail:
        sentinel === undefined
          ? 'the clean change passed'
          : `exit 0: ${redact(firstMatchingLine(text, sentinel), variables)}`,
    };
  }
  const hit = wanted.match[0] === undefined ? shown : firstMatchingLine(text, wanted.match[0]);
  return {
    result: RESULT.REJECTED,
    detail: `exit ${String(outcome.status)}: ${redact(hit, variables)}`,
  };
}

/**
 * Renders the expected rejection for the report.
 *
 * @param {Fixture} fixture - The fixture.
 * @returns {string} For example `exit nonzero, /no-explicit-any/`.
 */
export function expectedText(fixture) {
  if (fixture.control === true) {
    const sentinel = fixture.expected?.match[0];
    return sentinel === undefined ? 'exit 0' : `exit 0, ${String(sentinel)}`;
  }
  const wanted = fixture.expected;
  if (wanted === undefined) {
    return 'CI only';
  }
  const pattern = wanted.match[0];
  return pattern === undefined
    ? `exit ${String(wanted.status)}`
    : `exit ${String(wanted.status)}, ${String(pattern)}`;
}

/**
 * Builds one report row.
 *
 * @param {Fixture} fixture - The fixture.
 * @param {{ result: string, detail: string }} judged - Result and detail.
 * @param {number} ms - Time in milliseconds.
 * @returns {Record<string, string | number>} The row.
 */
function rowOf(fixture, judged, ms) {
  const needs = fixture.needs === undefined ? '' : ` (needs agent ${fixture.needs})`;
  return {
    id: fixture.id,
    row: fixture.row,
    change: fixture.change,
    gate: `${fixture.gate}${needs}`,
    expected: expectedText(fixture),
    result: judged.result,
    detail: judged.detail,
    ms,
  };
}

/**
 * Runs one fixture: reset, setup, gate command, judgement. A setup error is a FAIL row.
 *
 * @param {Fixture} fixture - The fixture.
 * @param {{ variables: Record<string, string>, reset: () => void, apply: (step: Record<string, unknown>) => void, run: (call: ReturnType<typeof resolveRun>) => { status: number, stdout: string, stderr: string, started: boolean, timedOut: boolean } }} context - The executor.
 * @returns {Record<string, string | number>} The report row.
 */
export function runFixture(fixture, context) {
  const started = Date.now();
  let judged;
  try {
    context.reset();
    for (const step of fixture.setup ?? []) {
      context.apply(step);
    }
    if (fixture.run === undefined) {
      throw new Error('the fixture has no run spec');
    }
    judged = evaluate(
      fixture,
      context.run(resolveRun(fixture.run, context.variables)),
      context.variables,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    judged = { result: RESULT.SETUP_FAILED, detail: redact(message, context.variables) };
  }
  return rowOf(fixture, judged, Date.now() - started);
}

/**
 * Picks the fixtures to run. A CI-only fixture is always skipped. A slow fixture is skipped unless
 * `slow` is set. An id that does not exist is an error, so a typo cannot pass as "nothing failed".
 *
 * @param {Fixture[]} fixtures - All fixtures, in report order.
 * @param {{ only: string[], slow: boolean }} options - The selection.
 * @returns {{ fixture: Fixture, skip: string | null }[]} The plan, in report order. `skip` is the SKIP result, or null when the fixture runs.
 */
export function selectFixtures(fixtures, options) {
  const known = new Set(fixtures.map((fixture) => fixture.id));
  const unknown = options.only.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`unknown fixture id: ${unknown.join(', ')}`);
  }
  const wanted = new Set(options.only);
  return fixtures
    .filter((fixture) => options.only.length === 0 || wanted.has(fixture.id))
    .map((fixture) => {
      if (fixture.ciLater === true) {
        return { fixture, skip: RESULT.CI_LATER };
      }
      return { fixture, skip: fixture.slow === true && !options.slow ? RESULT.SLOW : null };
    });
}

/**
 * Runs a plan.
 *
 * @param {{ fixture: Fixture, skip: string | null }[]} plan - Output of `selectFixtures`.
 * @param {Parameters<typeof runFixture>[1] & { onRow?: (row: Record<string, string | number>) => void }} context - The executor and an optional progress callback.
 * @returns {Record<string, string | number>[]} One row for each fixture, in plan order.
 */
export function runAll(plan, context) {
  return plan.map(({ fixture, skip }) => {
    const row =
      skip === null
        ? runFixture(fixture, context)
        : rowOf(fixture, { result: skip, detail: skipDetail(skip) }, 0);
    context.onRow?.(row);
    return row;
  });
}

/**
 * Explains a SKIP result.
 *
 * @param {string} skip - A SKIP result.
 * @returns {string} The reason.
 */
function skipDetail(skip) {
  return skip === RESULT.SLOW
    ? 'slow: run with --slow'
    : 'only CI can prove this row (CI is not set up yet)';
}

/**
 * Tells whether a result is a failure.
 *
 * @param {string} result - A RESULT value.
 * @returns {boolean} True for every FAIL.
 */
export function isFailure(result) {
  return result.startsWith('FAIL');
}

/**
 * Counts the results.
 *
 * @param {{ result: string | number }[]} rows - Report rows.
 * @returns {{ pass: number, fail: number, skip: number }} The counts.
 */
export function summarize(rows) {
  const counts = { pass: 0, fail: 0, skip: 0 };
  for (const row of rows) {
    const result = String(row.result);
    if (result.startsWith('PASS')) {
      counts.pass += 1;
    } else if (isFailure(result)) {
      counts.fail += 1;
    } else {
      counts.skip += 1;
    }
  }
  return counts;
}

/**
 * Gives the exit code of a run: 1 when any fixture that ran was not rejected (or a control failed).
 *
 * @param {{ result: string | number }[]} rows - Report rows.
 * @returns {number} 0 or 1.
 */
export function exitCodeFor(rows) {
  return summarize(rows).fail > 0 ? 1 : 0;
}

/**
 * Reads the command line.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @returns {{ only: string[], slow: boolean, keep: boolean, list: boolean, help: boolean, report: string, error: string }} The options. `error` is set for a bad argument.
 */
export function parseFixtureArguments(argv) {
  const options = {
    only: [],
    slow: false,
    keep: false,
    list: false,
    help: false,
    report: '',
    error: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index] ?? '';
    const next = argv[index + 1] ?? '';
    if (word === '--only' || word === '--report') {
      if (next === '' || next.startsWith('--')) {
        return { ...options, error: `${word} needs a value` };
      }
      index += 1;
      if (word === '--only') {
        options.only = next.split(',').filter((id) => id !== '');
      } else {
        options.report = next;
      }
    } else if (word === '--slow' || word === '--keep' || word === '--list') {
      options[word.slice(2)] = true;
    } else if (word === '--help' || word === '-h') {
      options.help = true;
    } else {
      return { ...options, error: `unknown argument: ${word}` };
    }
  }
  return options;
}

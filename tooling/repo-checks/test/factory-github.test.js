// Tests for the gh wrapper, `push` and the `route` store of scripts/factory.mjs (design
// factory-daily-run 4.1, R-17, R-20, R-37, R-54). `gh` and `git` are stubs, except in the CLI
// tests: those use a temp repo with a local bare remote. No test calls the real gh or the network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { main } from '../scripts/factory.mjs';
import { FactoryError } from '../scripts/lib/factory-base.mjs';
import { createGh, failureReason, HardStopError, redact } from '../scripts/lib/factory-github.mjs';
import { checkBranch, pushCommand } from '../scripts/lib/factory-push.mjs';
import { routingLine } from '../scripts/lib/factory-route.mjs';
import { readOptional, readRepositoryFile, writeAtomic } from '../scripts/lib/fs-io.mjs';
import { CHECK_CONFIG_MESSAGE } from '../scripts/lib/test-guard-rules.mjs';

import { pathFromEnv } from './test-env.config.js';

const FACTORY = fileURLToPath(new URL('../scripts/factory.mjs', import.meta.url));
const STATE = '.claude/factory';
const PUSH_ARGUMENTS = ['push', 'origin', 'HEAD:feat/7-x'];
const BRANCH_CALL = ['branch', '--show-current'];
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const temporaryFolder = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'factory-github-'));
  roots.push(root);
  return root;
};

// gh wrapper (R-54)

test('R-54: a gh call that fails once is retried once and returns the second output', () => {
  const calls = [];
  const exec = (command, args) => {
    calls.push([command, ...args]);
    if (calls.length === 1) throw new Error('network down');
    return 'ok\n';
  };
  assert.equal(createGh(exec)(['issue', 'view', '7']), 'ok\n');
  assert.deepEqual(calls, [
    ['gh', 'issue', 'view', '7'],
    ['gh', 'issue', 'view', '7'],
  ]);
});

test('R-54: a gh stub that fails twice gives a hard stop error after exactly two calls', () => {
  let count = 0;
  const exec = () => {
    count += 1;
    throw new Error(`boom ${String(count)}`);
  };
  assert.throws(
    () => createGh(exec)(['issue', 'view', '7']),
    (error) =>
      error instanceof HardStopError &&
      error instanceof FactoryError &&
      error.code === 'hard-stop' &&
      error.message.startsWith('hard stop: ') &&
      error.message.includes('gh issue view') &&
      error.message.includes('boom 2'),
  );
  assert.equal(count, 2);
});

// push (R-17, R-54)

function makeGit({ branch = 'feat/7-x', pushes = [], mergeFails = false } = {}) {
  const calls = [];
  const results = [...pushes];
  const git = (args) => {
    calls.push(args);
    if (args[0] === 'branch') return `${branch}\n`;
    if (args[0] === 'push') {
      const next = results.shift();
      if (next instanceof Error) throw next;
    }
    if (args[0] === 'merge' && args[1] === '--no-edit' && mergeFails) throw new Error('CONFLICT');
    return args[0] === 'diff' ? 'a.txt\nb.txt\n' : '';
  };
  return { git, calls };
}

// What git prints for a push that needs a fetch first. The text is the part the code matches.
const rejection = (reason = 'fetch first') =>
  Object.assign(new Error('Command failed: git push'), {
    stderr: `! [rejected]        HEAD -> feat/7-x (${reason})\n`,
  });

function makeContext({ findings = [], ...gitOptions } = {}) {
  const { git, calls } = makeGit(gitOptions);
  const bases = [];
  const out = [];
  const guard = (base) => {
    bases.push(base);
    return findings;
  };
  const context = {
    root: temporaryFolder(),
    gh: () => '',
    git,
    guard,
    now: () => new Date('2026-11-17T10:00:00Z'),
    pid: process.pid,
    stdin: () => '',
    print: (text) => out.push(text),
  };
  return { context, calls, bases, out };
}

const push = (context, ticket = 7) => pushCommand([String(ticket)], context);
const pushed = (calls) => calls.filter((call) => call[0] === 'push');
const stateFile = (context, name) =>
  JSON.parse(readRepositoryFile(context.root, `${STATE}/7/${name}`));
const seedTicket = (context, extra) =>
  writeAtomic(
    path.join(context.root, STATE, '7', 'ticket.json'),
    JSON.stringify({ issue: 7, stage: 'building', branch: 'feat/7-x', base: null, ...extra }),
  );
const blocking = { file: 'a.test.js', line: 1, message: 'test file deleted' };
const configFinding = { file: '.github/x.yml', line: 1, message: CHECK_CONFIG_MESSAGE };

test('R-54: push runs only git push origin HEAD:<branch>, with no + and no force flag', () => {
  const { context, calls } = makeContext();
  push(context);
  assert.deepEqual(calls, [BRANCH_CALL, PUSH_ARGUMENTS]);
  for (const argument of calls.flat()) {
    assert.ok(!argument.startsWith('+'), argument);
    assert.ok(!/force|^-f$/.test(argument), argument);
  }
});

test('R-54: a rejected push fetches, merges the remote branch and pushes once more', () => {
  const { context, calls, out } = makeContext({ pushes: [rejection()] });
  push(context);
  assert.deepEqual(calls, [
    BRANCH_CALL,
    PUSH_ARGUMENTS,
    ['fetch', 'origin', 'feat/7-x'],
    ['merge', '--no-edit', 'FETCH_HEAD'],
    PUSH_ARGUMENTS,
  ]);
  assert.ok(calls.every((call) => call[0] !== 'rebase' && !call.includes('--rebase')));
  const text = out.join('');
  assert.match(text, /push rejected/);
  assert.match(text, /pushed feat\/7-x/);
});

test('R-54: a second reject is a hard stop', () => {
  const rejected = rejection();
  const { context, calls } = makeContext({ pushes: [rejected, rejected] });
  assert.throws(
    () => push(context),
    (error) => error instanceof HardStopError && /^hard stop: .*rejected twice/.test(error.message),
  );
  assert.equal(pushed(calls).length, 2);
});

test('R-54: a failed fetch after a reject is a hard stop with no merge and no second push', () => {
  const { context, calls } = makeContext({ pushes: [rejection()] });
  const original = context.git;
  context.git = (args) => {
    if (args[0] === 'fetch') {
      calls.push(args);
      throw new Error('no route to host');
    }
    return original(args);
  };
  assert.throws(() => push(context), HardStopError);
  assert.equal(pushed(calls).length, 1);
  assert.ok(calls.every((call) => call[0] !== 'merge'));
});

test('R-55: a merge conflict aborts the merge and is a hard stop that lists the paths', () => {
  const { context, calls } = makeContext({ pushes: [rejection()], mergeFails: true });
  assert.throws(
    () => push(context),
    (error) =>
      error instanceof HardStopError &&
      error.message.includes('a.txt') &&
      error.message.includes('b.txt'),
  );
  assert.deepEqual(calls.slice(-2), [
    ['diff', '--name-only', '--diff-filter=U'],
    ['merge', '--abort'],
  ]);
  assert.equal(pushed(calls).length, 1);
});

test('R-55: a merge that fails with no conflict is a hard stop with the merge reason', () => {
  const { context, calls } = makeContext({ pushes: [rejection()] });
  const original = context.git;
  context.git = (args) => {
    if (args[0] === 'merge' && args[1] === '--no-edit') {
      calls.push(args);
      throw new Error('untracked working tree file would be overwritten');
    }
    if (args[0] === 'diff') {
      calls.push(args);
      return '\n';
    }
    if (args[0] === 'merge' && args[1] === '--abort') {
      calls.push(args);
      throw new Error('There is no merge to abort');
    }
    return original(args);
  };
  assert.throws(
    () => push(context),
    (error) =>
      error instanceof HardStopError &&
      error.message.includes('untracked working tree file would be overwritten') &&
      !error.message.includes('Conflicts:'),
  );
  assert.equal(pushed(calls).length, 1);
});

test('R-54: a push that fails for another reason than a non-fast-forward is a hard stop at once', () => {
  for (const reason of ['pre-push hook declined', 'Authentication failed']) {
    const { context, calls } = makeContext({
      pushes: [Object.assign(new Error(reason), { stderr: `${reason}\n` })],
    });
    assert.throws(
      () => push(context),
      (error) => error instanceof HardStopError && error.message.includes(reason),
    );
    assert.deepEqual(calls, [BRANCH_CALL, PUSH_ARGUMENTS], reason);
  }
});

test('R-54: both git reject texts, fetch first and non-fast-forward, start the fetch and merge', () => {
  for (const reason of ['fetch first', 'non-fast-forward']) {
    const { context, calls } = makeContext({ pushes: [rejection(reason)] });
    push(context);
    assert.deepEqual(
      calls.map((call) => call[0]),
      ['branch', 'push', 'fetch', 'merge', 'push'],
      reason,
    );
  }
});

test('R-17: the test guard runs again after the merge, and a blocking finding stops the second push', () => {
  const { context, calls } = makeContext({ pushes: [rejection()] });
  seedTicket(context, {});
  let runs = 0;
  context.guard = () => {
    runs += 1;
    return runs === 1 ? [] : [blocking];
  };
  assert.throws(
    () => push(context),
    (error) =>
      error instanceof FactoryError &&
      !(error instanceof HardStopError) &&
      error.message.includes('test file deleted'),
  );
  assert.equal(runs, 2);
  assert.equal(pushed(calls).length, 1);
  assert.deepEqual(stateFile(context, 'ticket.json').push.blocked, {
    'a.test.js: test file deleted': 1,
  });
});

test('R-17: fixing 1 of 2 findings with the same message is progress, not a hard stop', () => {
  const second = { ...blocking, line: 9 };
  const { context, calls } = makeContext({ findings: [blocking, second] });
  seedTicket(context, {});
  assert.throws(() => push(context), FactoryError);
  assert.deepEqual(stateFile(context, 'ticket.json').push.blocked, {
    'a.test.js: test file deleted': 2,
  });
  const one = { ...context, guard: () => [blocking] };
  assert.throws(
    () => push(one),
    (error) => error instanceof FactoryError && !(error instanceof HardStopError),
  );
  assert.deepEqual(pushed(calls), []);
  assert.throws(
    () => push(one),
    (error) => error instanceof HardStopError && /stayed after the fix round/.test(error.message),
  );
  assert.deepEqual(pushed(calls), []);
});

test('R-17: a push.blocked value that is not an object counts as no stored round', () => {
  const { context } = makeContext({ findings: [blocking] });
  seedTicket(context, { push: { blocked: 'junk' } });
  assert.throws(
    () => push(context),
    (error) => error instanceof FactoryError && !(error instanceof HardStopError),
  );
  assert.deepEqual(stateFile(context, 'ticket.json').push.blocked, {
    'a.test.js: test file deleted': 1,
  });
});

test('R-17: the fix-round state keeps the other keys of ticket.json', () => {
  const { context } = makeContext({ findings: [blocking] });
  seedTicket(context, { pr: 12, routing: { tier: 'low' } });
  assert.throws(() => push(context), FactoryError);
  const state = stateFile(context, 'ticket.json');
  assert.equal(state.pr, 12);
  assert.deepEqual(state.routing, { tier: 'low' });
  assert.equal(readOptional(path.join(context.root, STATE, '7', 'push.json')), undefined);
});

test('R-17: with no ticket state, a blocking finding blocks and a warning says it is not tracked', () => {
  const { context, calls, out } = makeContext({ findings: [blocking] });
  assert.throws(() => push(context), FactoryError);
  assert.match(out.join(''), /warning: .*cannot be tracked/);
  assert.deepEqual(pushed(calls), []);
  assert.equal(readOptional(path.join(context.root, STATE, '7', 'push.json')), undefined);
  assert.equal(readOptional(path.join(context.root, STATE, '7', 'ticket.json')), undefined);
});

test('push refuses to push to main, master or the stored base branch', () => {
  for (const [branch, extra] of [
    ['main', {}],
    ['master', {}],
    ['feat/92-table', { branch: 'feat/92-table', base: 'feat/92-table' }],
  ]) {
    const { context, calls, bases } = makeContext({ branch });
    seedTicket(context, { branch, ...extra });
    assert.throws(
      () => push(context),
      (error) => error instanceof FactoryError && error.message.includes(branch),
    );
    assert.deepEqual(pushed(calls), [], branch);
    assert.deepEqual(bases, [], branch);
  }
  const bare = makeContext({ branch: 'main' });
  assert.throws(() => push(bare.context), FactoryError);
  assert.deepEqual(pushed(bare.calls), []);
});

test('R-17: a non-config finding makes push fail with no git push, and stores the finding', () => {
  const { context, calls } = makeContext({ findings: [blocking] });
  seedTicket(context, {});
  assert.throws(
    () => push(context),
    (error) =>
      error instanceof FactoryError &&
      !(error instanceof HardStopError) &&
      error.message.includes('test file deleted') &&
      error.message.includes('a.test.js'),
  );
  assert.deepEqual(pushed(calls), []);
  assert.deepEqual(stateFile(context, 'ticket.json').push.blocked, {
    'a.test.js: test file deleted': 1,
  });
});

test('R-17: the same finding on the next push is a hard stop with no git push', () => {
  const { context, calls } = makeContext({ findings: [blocking] });
  seedTicket(context, {});
  assert.throws(() => push(context), FactoryError);
  assert.throws(
    () => push(context),
    (error) => error instanceof HardStopError && /stayed after the fix round/.test(error.message),
  );
  assert.deepEqual(pushed(calls), []);
});

test('R-17: a fixed finding lets the next push through and clears the stored round', () => {
  const { context, calls } = makeContext({ findings: [blocking] });
  seedTicket(context, {});
  assert.throws(() => push(context), FactoryError);
  const fixed = { ...context, guard: () => [] };
  push(fixed);
  assert.equal(pushed(calls).length, 1);
  assert.deepEqual(stateFile(context, 'ticket.json').push.blocked, {});
});

test('R-17: a new finding after a fix round gets its own fix round', () => {
  const { context } = makeContext({ findings: [blocking] });
  seedTicket(context, {});
  assert.throws(() => push(context), FactoryError);
  const other = { file: 'b.test.js', line: 2, message: 'test file deleted' };
  const changed = { ...context, guard: () => [other] };
  assert.throws(
    () => push(changed),
    (error) => error instanceof FactoryError && !(error instanceof HardStopError),
  );
});

test('R-17: the check-config finding does not block, and is printed for the router and PR body', () => {
  const { context, calls, out } = makeContext({ findings: [configFinding] });
  seedTicket(context, {});
  push(context);
  assert.equal(pushed(calls).length, 1);
  assert.match(out.join(''), /check config changed/);
  // Design 4.3 has no push.json, and the router computes the flag again: it is not stored.
  assert.equal(readOptional(path.join(context.root, STATE, '7', 'push.json')), undefined);
  assert.equal(stateFile(context, 'ticket.json').push.checkConfig, undefined);
});

test('R-17: a config finding next to a blocking finding still blocks', () => {
  const { context, calls } = makeContext({ findings: [configFinding, blocking] });
  seedTicket(context, {});
  assert.throws(() => push(context), FactoryError);
  assert.deepEqual(pushed(calls), []);
  assert.deepEqual(stateFile(context, 'ticket.json').push.blocked, {
    'a.test.js: test file deleted': 1,
  });
});

test('R-37: the guard base is origin/<stored base>, or origin/main with no stored base', () => {
  const none = makeContext();
  push(none.context);
  assert.deepEqual(none.bases, ['origin/main']);
  const stacked = makeContext();
  seedTicket(stacked.context, { base: 'feat/92-favorites-table' });
  push(stacked.context);
  assert.deepEqual(stacked.bases, ['origin/feat/92-favorites-table']);
});

test('push refuses a branch name that is not safe, with no guard run and no git push', () => {
  for (const name of [
    '-x',
    '+x',
    '--force',
    'a b',
    'a..b',
    'a:b',
    'a//b',
    'x.lock',
    'a/',
    '.x',
    'feat/.x',
    'a/./b',
  ]) {
    assert.throws(() => checkBranch(name), FactoryError, name);
  }
  for (const name of ['feat/7-x', 'fix/a.b_c-1']) assert.doesNotThrow(() => checkBranch(name));
  for (const branch of ['+evil', '-evil', '']) {
    const { context, calls, bases } = makeContext({ branch });
    assert.throws(() => push(context), FactoryError, branch);
    assert.deepEqual(pushed(calls), []);
    assert.deepEqual(bases, []);
  }
});

test('push refuses when HEAD is not on the branch of the ticket state', () => {
  const { context, calls } = makeContext({ branch: 'feat/other' });
  seedTicket(context, {});
  assert.throws(() => push(context), /feat\/other/);
  assert.deepEqual(pushed(calls), []);
});

test('push with a bad ticket number exits through FactoryError', () => {
  const { context } = makeContext();
  assert.throws(() => pushCommand(['abc'], context), FactoryError);
  assert.throws(() => pushCommand([], context), FactoryError);
});

test('failureReason redacts URL credentials and tokens', () => {
  const token = `ghp_${'a1B2'.repeat(6)}`;
  const pat = `github_pat_${'x_Y9'.repeat(6)}`;
  const error = Object.assign(new Error('Command failed'), {
    stderr: `fatal: https://user:pass@github.com/a/b.git and ssh://${token}@host/x failed, ${pat} gho_${'Z'.repeat(25)}\n`,
  });
  const text = failureReason(error);
  assert.match(text, /https:\/\/\*\*\*@github\.com/);
  assert.match(text, /ssh:\/\/\*\*\*@host/);
  for (const secret of ['user', 'pass', token, pat, 'gho_']) {
    assert.ok(!text.includes(secret), secret);
  }
  assert.ok(failureReason(new Error(`boom ${token}`)).includes('boom ***'));
});

// redact runs on a hard-stop excerpt of up to 1 MiB: it must stay linear on text that fits a pattern class

const MEGABYTE = 1024 * 1024;
const TIME_LIMIT_MS = 1000;

/** Asserts that redact finishes in under a second on the text, and returns its output. */
function timedRedact(text) {
  const start = performance.now();
  const output = redact(text);
  const elapsed = performance.now() - start;
  assert.ok(
    elapsed < TIME_LIMIT_MS,
    `redact took ${Math.round(elapsed)} ms on ${text.length} bytes`,
  );
  return output;
}

test('redact is linear on 1 MB of hyphens, dots and plus signs, and still gives the right text', () => {
  for (const unit of ['a-', 'a.', 'a+', 'token-']) {
    const text = unit.repeat(Math.ceil(MEGABYTE / unit.length));
    assert.equal(timedRedact(text), text, unit);
  }
  const filler = 'a-'.repeat(MEGABYTE / 4);
  assert.equal(
    timedRedact(`${filler} https://user:pass@github.com/a/b.git ${filler}`),
    `${filler} https://***@github.com/a/b.git ${filler}`,
  );
});

test('redact is linear on 1 MB of scheme-like text and keeps a long scheme credential out', () => {
  const texts = ['a://'.repeat(MEGABYTE / 4), `a://${'b'.repeat(MEGABYTE)}`, 'a'.repeat(MEGABYTE)];
  for (const text of texts) assert.equal(timedRedact(text), text);
  const long = `${'x'.repeat(40)}://user:pass@host`;
  assert.ok(!timedRedact(long).includes('user:pass'), 'a scheme longer than 32 characters');
  assert.ok(!timedRedact('+svn+ssh://user:pass@host').includes('user:pass'), 'plus before scheme');
});

// route stores its JSON (R-20)

const GIT_ENV = {
  PATH: pathFromEnv(),
  HOME: tmpdir(),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

function commitFile(cwd, name, text) {
  mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true });
  writeFileSync(path.join(cwd, name), text);
  git(cwd, 'add', name);
  git(cwd, 'commit', '-qm', `add ${name}`);
}

/** A work repo on feat/7-x with a bare remote that holds main. Returns paths and a clone maker. */
function makeRepository() {
  const folder = temporaryFolder();
  const remote = path.join(folder, 'remote.git');
  const work = path.join(folder, 'work');
  git(folder, 'init', '-q', '--bare', '-b', 'main', remote);
  git(folder, 'init', '-q', '-b', 'main', work);
  git(work, 'config', 'commit.gpgsign', 'false');
  git(work, 'config', 'core.hooksPath', '/dev/null');
  git(work, 'remote', 'add', 'origin', remote);
  commitFile(work, 'README.md', 'hello\n');
  git(work, 'push', '-q', 'origin', 'main');
  git(work, 'checkout', '-q', '-b', 'feat/7-x');
  commitFile(work, 'src/a.js', 'export const a = 1;\n');
  return { folder, remote, work };
}

function routeRun(work) {
  const out = [];
  const errors = [];
  const gh = (args) => (args[0] === 'issue' ? JSON.stringify({ body: 'Size: 2' }) : '');
  const code = main(['node', 'factory.mjs', 'route', '7', '--base', 'main'], {
    root: work,
    gh,
    print: (text) => out.push(text),
    err: (text) => errors.push(text),
  });
  return { code, out: out.join(''), errors: errors.join('') };
}

const ticketPath = (work, name = 'ticket.json') => path.join(work, STATE, '7', name);

test('R-20: route stores the JSON in the routing field of ticket.json and keeps the other keys', () => {
  const { work } = makeRepository();
  writeAtomic(
    ticketPath(work),
    JSON.stringify({ issue: 7, stage: 'building', branch: 'feat/7-x', pr: 12, routing: {} }),
  );
  const { code, out, errors } = routeRun(work);
  assert.equal(code, 0, errors);
  const state = JSON.parse(readRepositoryFile(work, `${STATE}/7/ticket.json`));
  assert.deepEqual(state.routing, JSON.parse(out));
  assert.equal(state.pr, 12);
  assert.equal(state.branch, 'feat/7-x');
  assert.equal(state.routing.base, 'main');
  assert.equal(state.routing.budget, 300);
  assert.ok(state.routing.passes.some((pass) => pass.name === 'spec-reviewer'));
  // The routing line goes to stderr only. No extra files.
  assert.equal(errors, `${routingLine(state.routing)}\n`);
  assert.equal(readOptional(ticketPath(work, 'route.json')), undefined);
  assert.equal(readOptional(ticketPath(work, 'route-line.txt')), undefined);
});

test('R-20: route with no ticket.json prints the JSON, warns that nothing was stored, exits 0', () => {
  const { work } = makeRepository();
  const { code, out, errors } = routeRun(work);
  assert.equal(code, 0, errors);
  assert.equal(JSON.parse(out).base, 'main');
  assert.match(errors, /warning: .*nothing stored/);
  assert.match(errors, /Routing: tier /);
  assert.equal(readOptional(ticketPath(work)), undefined);
  assert.equal(readOptional(ticketPath(work, 'route.json')), undefined);
});

test('R-20: routingLine has the tier, each pass with its model, each skipped pass and warnings', () => {
  const line = routingLine({
    tier: 'high',
    passes: [{ name: 'spec-reviewer', model: 'opus', rule: 'always' }],
    skipped: [{ name: 'infra-reviewer', reason: 'no path matched' }],
    changedLines: 912,
    budget: 800,
    overBudget: true,
    warnings: ['size missing: budget 800'],
  });
  assert.equal(
    line,
    'Routing: tier high; passes spec-reviewer (opus); skipped infra-reviewer (no path matched); ' +
      '912/800 lines, over budget; warnings: size missing: budget 800',
  );
  assert.ok(!line.includes('\n'));
});

// CLI with real git and a local bare remote

const run = (cwd, ...args) =>
  spawnSync(process.execPath, [FACTORY, ...args], { cwd, env: GIT_ENV, encoding: 'utf8' });

test('CLI: push sends the branch to the remote and prints the steps', () => {
  const { remote, work } = makeRepository();
  const result = run(work, 'push', '7');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /pushed feat\/7-x/);
  assert.equal(git(remote, 'rev-parse', 'feat/7-x'), git(work, 'rev-parse', 'HEAD'));
});

test('CLI: push after the remote moved ahead fetches, merges and pushes again', () => {
  const { folder, remote, work } = makeRepository();
  assert.equal(run(work, 'push', '7').status, 0);
  const other = path.join(folder, 'other');
  git(folder, 'clone', '-q', remote, other);
  git(other, 'checkout', '-q', 'feat/7-x');
  commitFile(other, 'remote-only.txt', 'remote\n');
  git(other, 'push', '-q', 'origin', 'feat/7-x');
  commitFile(work, 'src/b.js', 'export const b = 2;\n');
  const result = run(work, 'push', '7');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /push rejected/);
  assert.match(result.stdout, /git fetch origin feat\/7-x/);
  assert.match(result.stdout, /git merge --no-edit FETCH_HEAD/);
  assert.match(result.stdout, /pushed feat\/7-x after fetch and merge/);
  const head = git(work, 'rev-parse', 'HEAD');
  assert.equal(git(remote, 'rev-parse', 'feat/7-x'), head);
  assert.match(git(work, 'log', '-1', '--format=%P'), /\S+ \S+/);
});

test('CLI: a deleted test file makes push exit non-zero and nothing reaches the remote', () => {
  const { remote, work } = makeRepository();
  commitFile(work, 'src/a.test.js', "it('a', () => {});\n");
  git(work, 'checkout', '-q', 'main');
  git(work, 'merge', '-q', '--ff-only', 'feat/7-x');
  git(work, 'push', '-q', 'origin', 'main');
  git(work, 'checkout', '-q', 'feat/7-x');
  git(work, 'rm', '-q', 'src/a.test.js');
  git(work, 'commit', '-qm', 'drop test');
  // The fix-round count lives in ticket.json (design 4.3): without it a repeat is not tracked.
  writeAtomic(
    ticketPath(work),
    JSON.stringify({ issue: 7, stage: 'building', branch: 'feat/7-x', base: null }),
  );
  const result = run(work, 'push', '7');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /test file deleted/);
  const references = spawnSync('git', ['branch', '--list', 'feat/7-x'], {
    cwd: remote,
    env: GIT_ENV,
  });
  assert.equal(references.stdout.toString().trim(), '');
  assert.equal(run(work, 'push', '7').status, 3);
});

test('CLI: a gh that always fails ends in exit 3 with hard stop: after two calls', () => {
  const { folder, work } = makeRepository();
  const bin = path.join(folder, 'bin');
  mkdirSync(bin);
  writeAtomic(
    path.join(bin, 'gh'),
    '#!/bin/sh\necho "$@" >> "$(dirname "$0")/calls.log"\necho boom >&2\nexit 1\n',
  );
  chmodSync(path.join(bin, 'gh'), 0o755);
  const result = spawnSync(process.execPath, [FACTORY, 'route', '7', '--base', 'main'], {
    cwd: work,
    env: { ...GIT_ENV, PATH: `${bin}${path.delimiter}${pathFromEnv()}` },
    encoding: 'utf8',
  });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /^hard stop: .*gh issue view/m);
  assert.deepEqual(readOptional(path.join(bin, 'calls.log'))?.trimEnd().split('\n'), [
    'issue view 7 --json body',
    'issue view 7 --json body',
  ]);
});

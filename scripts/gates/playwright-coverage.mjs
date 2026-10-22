// Playwright coverage gate: every web page route needs a spec that calls page.goto and runs an axe check.
// Used by the Claude stop-gate, by pre-pr and by CI (check-gates).
import { repositoryRoot } from './lib/git-state.mjs';
import { checkWebProject, projectsWithWeb } from './lib/web-coverage.mjs';

const HELP = `playwright-coverage: fail when a web page route has no Playwright spec, or the spec has no axe check.

Usage:
  node scripts/gates/playwright-coverage.mjs [--project <name>] [--root <dir>]

For each projects/<name>/web, every app/**/page.(tsx|jsx|ts|js) (or src/app/**) is a route.
Route groups (group), parallel slots @slot and private folders _x are not routes. [id] matches one
segment, [...x] one or more, [[...x]] zero or more. Each route needs a spec in web/e2e/**/*.spec.*
that calls page.goto('<route>') (a literal string or a template with a \${} part) and, in the same
file, an axe check (new AxeBuilder(...), checkA11y(), injectAxe() or axe.run()). A web part with no e2e specs fails.

Options:
  --project <name>  check one project only.
  --root <dir>      repo root. Default: the git root of the current folder.
  --help            show this text.

Exit code: 0 pass, 1 findings (file:line: message on stderr), 2 bad usage.
`;

/**
 * Runs the gate.
 *
 * @param {string[]} argv - Arguments after the script name.
 * @returns {number} Exit code.
 */
export function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index] ?? '';
    const value = argv[index + 1];
    if (!['--project', '--root'].includes(flag) || value === undefined) {
      process.stderr.write(`unknown or incomplete argument: ${flag}\n\n${HELP}`);
      return 2;
    }
    options[flag.slice(2)] = value;
  }
  const root = repositoryRoot(options['root'] ?? process.cwd());
  const projects = options['project'] === undefined ? projectsWithWeb(root) : [options['project']];
  const messages = projects.flatMap((project) => checkWebProject(root, project));
  if (messages.length === 0) {
    process.stdout.write(
      `playwright-coverage: pass (${String(projects.length)} web project(s) checked)\n`,
    );
    return 0;
  }
  process.stderr.write(
    `${messages.join('\n')}\nplaywright-coverage: ${String(messages.length)} problem(s).\n`,
  );
  return 1;
}

if (import.meta.filename === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}

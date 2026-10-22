// Bruno coverage gate: every API route needs a Bruno request with an assertion.
// Used by the Claude stop-gate, by pre-pr and by CI (check-gates).
import { checkBrunoProject, projectsWithApi } from './lib/api-coverage.mjs';
import { repositoryRoot } from './lib/git-state.mjs';

const HELP = `bruno-coverage: fail when an API route has no Bruno request, or a request has no assertion.

Usage:
  node scripts/gates/bruno-coverage.mjs [--project <name>] [--root <dir>]

For each projects/<name>/ that has an api, api-py or api-go part, the routes come from
projects/<name>/contracts/dist/openapi.json (build the contracts first), or from contracts/routes.json.
Every method and path needs a .bru file in projects/<name>/bruno with the same method and path
(:id, {id} and {{id}} count as the same parameter) and at least one assert entry or test.

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
  const projects = options['project'] === undefined ? projectsWithApi(root) : [options['project']];
  const messages = projects.flatMap((project) => checkBrunoProject(root, project));
  if (messages.length === 0) {
    process.stdout.write(`bruno-coverage: pass (${String(projects.length)} project(s) checked)\n`);
    return 0;
  }
  process.stderr.write(
    `${messages.join('\n')}\nbruno-coverage: ${String(messages.length)} problem(s).\n`,
  );
  return 1;
}

if (import.meta.filename === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}

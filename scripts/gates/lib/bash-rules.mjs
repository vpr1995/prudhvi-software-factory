import { buildScope } from './bash-paths.mjs';
import { checkFiles } from './bash-rules-files.mjs';
import { checkGit, checkGitEnvironment } from './bash-rules-git.mjs';
import { checkTools } from './bash-rules-tools.mjs';
import { parseShell } from './shell-parse.mjs';

/**
 * @typedef {import('./bash-rules-git.mjs').GuardContext} GuardContext
 */

/**
 * Checks a whole Bash command line against the guard rules.
 *
 * The guard is a heuristic. It reads `cd`, variables, globs, brace lists, heredocs and `bash -c`,
 * and it errs on the side of blocking. The real enforcement is CODEOWNERS and the CI check-gates job.
 *
 * @param {string} command - The command from `tool_input.command`.
 * @param {GuardContext} context - Root, working folder and a lazy branch lookup.
 * @returns {string | null} The reason to block (text for Claude), or null when allowed.
 */
export function checkCommand(command, context) {
  const segments = parseShell(command);
  const environment = checkGitEnvironment(segments);
  if (environment !== null) {
    return environment;
  }
  const scoped = { ...context, scope: buildScope(segments, context) };
  const checkNested = (nested) => checkCommand(nested, context);
  for (const segment of segments) {
    if (segment.argv.length === 0 && segment.redirects.length === 0) {
      continue;
    }
    const reason =
      checkGit(segment, scoped, checkNested) ?? checkTools(segment) ?? checkFiles(segment, scoped);
    if (reason !== null) {
      return reason;
    }
  }
  return null;
}

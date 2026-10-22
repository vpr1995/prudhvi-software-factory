import { checkBrunoProject, projectsWithApi } from './api-coverage.mjs';
import { checkWebProject, projectsWithWeb } from './web-coverage.mjs';

/** @typedef {import('./rush-verify.mjs').Check} Check */

const PROJECT_PATH = /^projects\/([^/]+)\//;

/**
 * Gets the project folder names (under projects/) of changed paths.
 *
 * @param {string[]} changedPaths - Changed paths from the repo root.
 * @returns {Set<string>} Project names.
 */
function changedProjectNames(changedPaths) {
  return new Set(
    changedPaths.map((file) => PROJECT_PATH.exec(file)?.[1]).filter((name) => name !== undefined),
  );
}

/**
 * Runs the Bruno coverage and the Playwright coverage gates for the projects that changed.
 * A global change (`full`) checks every project.
 *
 * @param {string} root - Repo root.
 * @param {string[]} changedPaths - Changed paths from the repo root.
 * @param {boolean} full - True when a global file changed.
 * @returns {Check[]} Two checks: `bruno-coverage` and `playwright-coverage`.
 */
export function coverageChecks(root, changedPaths, full) {
  const names = changedProjectNames(changedPaths);
  const pick = (all) => (full ? all : all.filter((name) => names.has(name)));
  const apiProjects = pick(projectsWithApi(root));
  const webProjects = pick(projectsWithWeb(root));
  const bruno = apiProjects.flatMap((project) => checkBrunoProject(root, project));
  const playwright = webProjects.flatMap((project) => checkWebProject(root, project));
  return [
    {
      name: 'bruno-coverage',
      status: bruno.length === 0 ? 'pass' : 'fail',
      detail:
        bruno.length === 0
          ? `${String(apiProjects.length)} API project(s) checked`
          : bruno.join('\n'),
    },
    {
      name: 'playwright-coverage',
      status: playwright.length === 0 ? 'pass' : 'fail',
      detail:
        playwright.length === 0
          ? `${String(webProjects.length)} web project(s) checked`
          : playwright.join('\n'),
    },
  ];
}

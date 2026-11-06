// Messages of the stop gate: the block reason for unverified files.

const GATE_SCRIPT = 'tooling/repo-checks/scripts/stop-gate.mjs';
const MAX_FILES_SHOWN = 10;

/**
 * @typedef {import('./stop-gate-command.mjs').Project} Project
 * @typedef {{ path: string, project: Project | undefined, hash: string }} FileState
 */

/**
 * @param {FileState[]} files - Unverified files.
 * @returns {Map<string, string[]>} Package name to its files. Files with no project are not in it.
 */
export function byProject(files) {
  const groups = new Map();
  for (const file of files) {
    if (file.project) {
      const list = groups.get(file.project.packageName) ?? [];
      list.push(file.path);
      groups.set(file.project.packageName, list);
    }
  }
  return groups;
}

/**
 * @param {string[]} list - Paths.
 * @returns {string} At most MAX_FILES_SHOWN paths, with a count of the paths left out.
 */
export function showFiles(list) {
  const shown = list.slice(0, MAX_FILES_SHOWN);
  const more = list.length > shown.length ? `, and ${String(list.length - shown.length)} more` : '';
  return `${shown.join(', ')}${more}`;
}

/**
 * @param {FileState[]} files - Unverified files.
 * @param {boolean} subagent - True for SubagentStop.
 * @returns {string} The block reason.
 */
export function blockReason(files, subagent) {
  const groups = byProject(files);
  const orphans = files.filter((file) => !file.project).map((file) => file.path);
  const lines = ['Verify gate: these source files have no passing test run.'];
  for (const [name, list] of groups) {
    lines.push(`- ${name}: ${showFiles(list)}`);
  }
  if (orphans.length > 0) {
    lines.push(
      `- No Rush project: ${showFiles(orphans)}. Register the project in rush.json, then run its tests.`,
    );
  }
  if (groups.size > 0) {
    const only = [...groups.keys()].map((name) => `--only ${name}`).join(' ');
    lines.push(
      `Run: node common/scripts/install-run-rush.js test ${only}`,
      'Run it as the last command, with no pipe, "||", ";", "&" or "&&" after it. The hook gives credit only when Rush exits 0.',
    );
  }
  if (subagent) {
    lines.push(
      'If the test fails and you cannot fix it, stop and report the failing check in your final message. The gate lets you stop after a failed run of that command that covers these projects, while the files stay unchanged.',
      'Deferral is for the main session only.',
    );
  } else {
    lines.push(`To stop and ask the owner first, run: node ${GATE_SCRIPT} defer "<reason>"`);
  }
  lines.push(
    'This is a hard block. Claude Code ends the turn after 8 blocks in a row with no tool call.',
  );
  return lines.join('\n');
}

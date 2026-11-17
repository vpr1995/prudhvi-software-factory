// Settings of scripts/factory.mjs. Lint allows process.env only in config files.
import { homedir } from 'node:os';
import path from 'node:path';

/** Project board of the factory (design 4.5). The script finds field and option IDs by name. */
export const BOARD = { owner: 'vpr1995', number: '2', statusField: 'Status' };

/** @returns {boolean} True when `FACTORY_RUN=off` is set in the environment (R-4). */
export const isRunOff = () => process.env.FACTORY_RUN?.trim().toLowerCase() === 'off';

/**
 * @returns {string} The folder of the Claude Code transcripts: `<config dir>/projects`. The config
 *   dir is `CLAUDE_CONFIG_DIR`, else `~/.claude`. The cost script (R-33) reads only this folder.
 */
export const transcriptRoot = () =>
  path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude'), 'projects');

/**
 * @returns {string | undefined} The ID of the current Claude Code session (`CLAUDE_CODE_SESSION_ID`:
 *   the name of its transcript), or undefined when it is not set.
 */
export const currentSessionId = () => {
  const id = process.env.CLAUDE_CODE_SESSION_ID?.trim();
  return id === '' ? undefined : id;
};

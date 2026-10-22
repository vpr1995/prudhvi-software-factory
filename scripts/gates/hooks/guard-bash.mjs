import { checkCommand } from '../lib/bash-rules.mjs';
import { currentBranch } from '../lib/git-state.mjs';
import { blockWith, runHook } from '../lib/hook-io.mjs';

runHook(
  (context) => {
    if (!context.parsed) {
      return blockWith('guard-bash: the hook input was not valid JSON, so the command is blocked.');
    }
    const input = context.payload['tool_input'];
    const command = input !== null && typeof input === 'object' ? input['command'] : undefined;
    if (typeof command !== 'string' || command.trim() === '') {
      return { exitCode: 0 };
    }
    const reason = checkCommand(command, {
      root: context.root,
      cwd: context.cwd,
      currentBranch: () => currentBranch(context.cwd),
    });
    return reason === null
      ? { exitCode: 0 }
      : blockWith(
          `BLOCKED by guard-bash: ${reason}\nIf you think this rule is wrong, stop and tell the human what you tried and why.`,
        );
  },
  { failClosed: true, name: 'guard-bash' },
);

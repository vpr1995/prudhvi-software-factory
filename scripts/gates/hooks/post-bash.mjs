// PostToolUse and PostToolUseFailure hook for Bash: tell Claude what to do when a check command fails.
import { failedExitCode, isCheckCommand } from '../lib/failed-command.mjs';
import { addContext, runHook } from '../lib/hook-io.mjs';

runHook(
  (context) => {
    const input = context.payload['tool_input'];
    const command = input !== null && typeof input === 'object' ? input['command'] : undefined;
    const code = failedExitCode(context.payload);
    if (typeof command !== 'string' || code === null || !isCheckCommand(command)) {
      return { exitCode: 0 };
    }
    const eventName =
      context.payload['hook_event_name'] === 'PostToolUseFailure'
        ? 'PostToolUseFailure'
        : 'PostToolUse';
    return addContext(
      eventName,
      `This command failed (exit code ${String(code)}). Fix the cause. Do not skip, delete, or weaken tests or rules. Run it again after the fix.`,
    );
  },
  { failClosed: false, name: 'post-bash' },
);

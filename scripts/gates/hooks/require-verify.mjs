import { blockWith, runHook } from '../lib/hook-io.mjs';
import { verifyRefusal } from '../lib/verify-gate.mjs';

runHook(
  (context) => {
    if (!context.parsed) {
      return blockWith(
        'require-verify: the hook input was not valid JSON, so the command is blocked.',
      );
    }
    const input = context.payload['tool_input'];
    const command = input !== null && typeof input === 'object' ? input['command'] : undefined;
    if (typeof command !== 'string') {
      return { exitCode: 0 };
    }
    const refusal = verifyRefusal(command, context.root);
    return refusal === null ? { exitCode: 0 } : blockWith(refusal);
  },
  { failClosed: true, name: 'require-verify' },
);

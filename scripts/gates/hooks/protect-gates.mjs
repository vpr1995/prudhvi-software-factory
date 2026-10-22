import { findGate, repositoryRelativeCandidates, unlockText } from '../lib/gate-list.mjs';
import { blockWith, editedPaths, runHook } from '../lib/hook-io.mjs';

runHook(
  (context) => {
    if (!context.parsed) {
      return blockWith('protect-gates: the hook input was not valid JSON, so the edit is blocked.');
    }
    for (const file of editedPaths(context.payload)) {
      for (const relative of repositoryRelativeCandidates(context.root, context.cwd, file)) {
        const entry = findGate(relative);
        if (entry !== null) {
          return blockWith(
            `BLOCKED by protect-gates: ${relative} is a gate file (matches ${entry.glob}).\nWhy it is protected: ${entry.why}\nHow a human unlocks it: ${unlockText()}`,
          );
        }
      }
    }
    return { exitCode: 0 };
  },
  { failClosed: true, name: 'protect-gates' },
);

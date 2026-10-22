// UserPromptSubmit hook: reset the stop-attempt counters and add a risk tier guess as context.
import { findGate } from '../lib/gate-list.mjs';
import { changedSince, sessionBase, statePaths, writeCounter } from '../lib/git-state.mjs';
import { addContext, runHook } from '../lib/hook-io.mjs';
import { guessRiskTier } from '../lib/session-info.mjs';

runHook(
  (context) => {
    const paths = statePaths(context.root);
    writeCounter(paths.stopAttempts, 0);
    writeCounter(paths.subagentAttempts, 0);
    const changed = changedSince(context.root, sessionBase(context.root)).all;
    const guess = guessRiskTier(changed, (file) => findGate(file) !== null);
    return addContext(
      'UserPromptSubmit',
      `Risk tier guess for the work so far: ${guess.tier} (${guess.reason}). Put the final tier and reason in the PR description.`,
    );
  },
  { failClosed: false, name: 'prompt-context' },
);

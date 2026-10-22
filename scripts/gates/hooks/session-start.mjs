// SessionStart hook: print the repo state and setup problems, and save the session base commit.
import { runHook } from '../lib/hook-io.mjs';
import { recordSessionBase, sessionSummary } from '../lib/session-info.mjs';

runHook(
  (context) => {
    const source =
      typeof context.payload['source'] === 'string' ? context.payload['source'] : 'startup';
    recordSessionBase(context.root, source, source === 'resume' || source === 'compact');
    return { stdout: sessionSummary(context.root) };
  },
  { failClosed: false, name: 'session-start' },
);

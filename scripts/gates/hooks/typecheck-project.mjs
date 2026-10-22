// PostToolUse hook for Edit, Write, MultiEdit and NotebookEdit: typecheck the project that owns the file.
import { resolveEditedFile, typecheckEditedFile } from '../lib/edit-checks.mjs';
import { addContext, blockWith, editedPaths, runHook } from '../lib/hook-io.mjs';

runHook(
  (context) => {
    const results = editedPaths(context.payload)
      .map((rawPath) => resolveEditedFile(context.root, rawPath))
      .filter((file) => file !== null)
      .map((file) => typecheckEditedFile(context.root, file));
    const failures = [...new Set(results.flatMap((result) => result.failures))];
    const notes = [...new Set(results.flatMap((result) => result.notes))];
    if (failures.length > 0) {
      return blockWith(
        `${failures.join('\n\n')}\nFix the type errors. Do not use any, @ts-ignore or @ts-expect-error.`,
      );
    }
    return notes.length > 0
      ? addContext('PostToolUse', `typecheck notice: ${notes.join('; ')}`)
      : { exitCode: 0 };
  },
  { failClosed: false, name: 'typecheck-project' },
);

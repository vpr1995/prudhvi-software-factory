// PostToolUse hook for Edit, Write, MultiEdit and NotebookEdit: format, then lint the edited file.
import { checkEditedFile, resolveEditedFile } from '../lib/edit-checks.mjs';
import { addContext, blockWith, editedPaths, runHook } from '../lib/hook-io.mjs';

runHook(
  (context) => {
    const failures = [];
    const notes = [];
    for (const rawPath of editedPaths(context.payload)) {
      const file = resolveEditedFile(context.root, rawPath);
      if (file !== null) {
        const result = checkEditedFile(context.root, file);
        failures.push(...result.failures);
        notes.push(...result.notes);
      }
    }
    if (failures.length > 0) {
      return blockWith(
        `${failures.join('\n\n')}\nFix these problems in the file. Do not add disable comments or weaken rules.`,
      );
    }
    return notes.length > 0
      ? addContext('PostToolUse', `post-edit notice: ${[...new Set(notes)].join('; ')}`)
      : { exitCode: 0 };
  },
  { failClosed: false, name: 'post-edit' },
);

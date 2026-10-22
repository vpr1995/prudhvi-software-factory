// Requires `TODO(#123): description` for work-marker comments (replaces core `no-warning-comments`).

const UPPERCASE_MARKER = /\b(?:TODO|FIXME|HACK|XXX)\b/;
const LOWERCASE_MARKER = /\b(?:todo|fixme)\b\s*[:(]/i;
const VALID_FORMAT = /\b(?:TODO|FIXME)\(#\d+\): \S/;

/** @type {import('eslint').Rule.RuleModule} */
export const todoWithIssue = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require TODO and FIXME comments to link an issue as `TODO(#123): text`.',
    },
    schema: [],
    messages: {
      invalidTodo: 'Write work markers as `TODO(#123): description` with an issue number.',
      bannedMarker: 'Do not use HACK or XXX. Write `TODO(#123): description` instead.',
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          for (const line of comment.value.split('\n')) {
            if (/\b(?:HACK|XXX)\b/.test(line)) {
              context.report({
                loc: comment.loc ?? { line: 1, column: 0 },
                messageId: 'bannedMarker',
              });
            } else if (
              (UPPERCASE_MARKER.test(line) || LOWERCASE_MARKER.test(line)) &&
              !VALID_FORMAT.test(line)
            ) {
              context.report({
                loc: comment.loc ?? { line: 1, column: 0 },
                messageId: 'invalidTodo',
              });
            }
          }
        }
      },
    };
  },
};

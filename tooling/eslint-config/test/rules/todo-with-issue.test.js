import { RuleTester } from 'eslint';
import { afterAll, describe, it } from 'vitest';

import { todoWithIssue } from '../../src/rules/todo-with-issue.js';

// eslint types declare describe, it and itOnly but not afterAll.
Object.assign(RuleTester, { afterAll });
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
});

ruleTester.run('todo-with-issue', todoWithIssue, {
  valid: [
    'const value = 1;',
    '// TODO(#123): replace the stub with the real client',
    '// FIXME(#7): handle the empty list',
    '/* TODO(#42): split this module */',
    '// a todo list is a normal phrase',
    '/**\n * Notes.\n * TODO(#9): document the options\n */',
  ],
  invalid: [
    { code: '// TODO fix this', errors: [{ messageId: 'invalidTodo' }] },
    { code: '// TODO: fix this', errors: [{ messageId: 'invalidTodo' }] },
    { code: '// TODO(123): missing hash', errors: [{ messageId: 'invalidTodo' }] },
    { code: '// TODO(#123) missing colon', errors: [{ messageId: 'invalidTodo' }] },
    { code: '// FIXME: later', errors: [{ messageId: 'invalidTodo' }] },
    { code: '// todo: lower case', errors: [{ messageId: 'invalidTodo' }] },
    { code: '// HACK around the parser', errors: [{ messageId: 'bannedMarker' }] },
    { code: '// XXX remove', errors: [{ messageId: 'bannedMarker' }] },
    {
      code: '/*\n * TODO(#1): fine\n * TODO later\n */',
      errors: [{ messageId: 'invalidTodo' }],
    },
  ],
});

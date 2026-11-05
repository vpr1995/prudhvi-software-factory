import { noSecretInLog } from './rules/no-secret-in-log.js';
import { todoWithIssue } from './rules/todo-with-issue.js';
import { zodSchemaNaming } from './rules/zod-schema-naming.js';

/** Local plugin. Rules are used as `local/<rule-name>`. */
export const localPlugin = {
  meta: { name: 'tooling-local', version: '0.0.0' },
  rules: {
    'no-secret-in-log': noSecretInLog,
    'todo-with-issue': todoWithIssue,
    'zod-schema-naming': zodSchemaNaming,
  },
};

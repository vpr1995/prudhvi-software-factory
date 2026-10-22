import { defineConfig } from 'eslint/config';

import {
  restrictedSyntaxBlocks,
  SHARED_SYNTAX_RULES,
  CONFIG_FILES,
  INDEX_FILES,
} from '../restricted-syntax.js';

import { ALL_CODE_FILES } from './globs.js';

const CDK_SYNTAX_RULES = [
  {
    id: 'account-id',
    selector: 'Literal[value=/^\\d{12}$/]',
    message:
      'Do not hard-code an AWS account ID. Read it from `config/<env>.ts` or the stack environment.',
  },
  {
    id: 'removal-destroy',
    selector: "MemberExpression[object.name='RemovalPolicy'][property.name='DESTROY']",
    message:
      'Do not use RemovalPolicy.DESTROY outside `config/dev.ts`. Take the policy from the env config.',
  },
  {
    id: 'construct-id',
    selector:
      "NewExpression[arguments.0.type='ThisExpression'][arguments.1.type='Literal'][arguments.1.value=/^[^A-Z]/]",
    message:
      'CDK construct IDs must be PascalCase, for example `new Bucket(this, "AssetsBucket")`.',
  },
];

/**
 * Rules for AWS CDK code (infra projects and platform/infra).
 *
 * @type {import('eslint').Linter.Config[]}
 */
export const cdk = defineConfig([
  ...restrictedSyntaxBlocks(
    [...SHARED_SYNTAX_RULES, ...CDK_SYNTAX_RULES],
    [
      { files: CONFIG_FILES, skip: ['process-env'] },
      { files: INDEX_FILES, skip: ['barrel'] },
      { files: ['**/config/dev.{ts,js}'], skip: ['removal-destroy'] },
    ],
  ),
  {
    name: 'tooling/cdk-sanity',
    files: ALL_CODE_FILES,
    rules: { '@typescript-eslint/no-magic-numbers': 'off' },
  },
]);

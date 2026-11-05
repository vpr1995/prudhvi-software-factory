import { RuleTester } from 'eslint';
import { afterAll, describe, it } from 'vitest';

import { noSecretInLog } from '../../src/rules/no-secret-in-log.js';

// eslint types declare describe, it and itOnly but not afterAll.
Object.assign(RuleTester, { afterAll });
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
});

const secretKey = [{ messageId: 'secretKey' }];

ruleTester.run('no-secret-in-log', noSecretInLog, {
  valid: [
    "logger.info({ userId, route }, 'login');",
    "logger.info('login');",
    "logger.error({ err }, 'failed');",
    'log.warn({ requestId: id, status: 200 });',
    'logger.child({ service: "api" });',
    // Spread: the keys are not known.
    'logger.info({ ...fields });',
    // Not a log method.
    'service.save({ password });',
    'logger.flush({ token });',
    // Not an object literal.
    'logger.info(payload);',
    // Computed key and computed method are out of scope.
    'logger.info({ [name]: 1 });',
    'logger[level]({ password });',
    // Whole-name match, like the logger redact list.
    'logger.info({ tokenCount: 3 });',
    // Secret name only as a value.
    "logger.info({ field: 'password' });",
    'logger.info({ user: { id } });',
  ],
  invalid: [
    { code: "logger.info({ password: 'x' }, 'login');", errors: secretKey },
    { code: "logger.info({ password }, 'login');", errors: secretKey },
    { code: 'log.error({ token: t });', errors: secretKey },
    { code: "logger.warn({ 'api_key': k });", errors: secretKey },
    { code: 'logger.debug({ apiKey });', errors: secretKey },
    { code: 'logger.trace({ Authorization: h });', errors: secretKey },
    { code: 'logger.fatal({ access_token: t });', errors: secretKey },
    { code: 'logger.info({ sessionId });', errors: secretKey },
    { code: 'logger.info({ creditCard });', errors: secretKey },
    {
      code: 'logger.info({ email, phone, ssn });',
      errors: [...secretKey, ...secretKey, ...secretKey],
    },
    { code: 'logger.child({ cookie });', errors: secretKey },
    { code: 'app.log.info({ secret });', errors: secretKey },
    { code: 'logger?.info({ token });', errors: secretKey },
    // Nested object literal.
    { code: 'logger.info({ user: { password } });', errors: secretKey },
    // Object in a later argument.
    { code: "logger.info('login', { password });", errors: secretKey },
  ],
});

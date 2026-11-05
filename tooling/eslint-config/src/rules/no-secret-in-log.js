// Bans secret and personal-data keys in the object argument of a logger call.
// Example: `logger.info({ password }, 'login')` is an error. The logger redact list is the second layer.

const LOG_METHODS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'log', 'child']);

/**
 * Mirror of `REDACTED_KEYS` in `packages/logger/src/redact.ts`, plus `creditCard` and `sessionId`.
 * Keys are compared in lower case without `_` and `-`, whole name only (`tokenCount` is fine, like in the logger). A tooling package must not import from `packages/*`, so keep both lists in sync by hand.
 */
const SECRET_KEYS = new Set(
  [
    'password',
    'passwd',
    'token',
    'accessToken',
    'refreshToken',
    'idToken',
    'sessionToken',
    'authToken',
    'secret',
    'clientSecret',
    'apiKey',
    'privateKey',
    'authorization',
    'proxyAuthorization',
    'cookie',
    'setCookie',
    'xApiKey',
    'xAuthToken',
    'xCsrfToken',
    'xAmzSecurityToken',
    'email',
    'phone',
    'ssn',
    'creditCard',
    'sessionId',
  ].map((key) => normalize(key)),
);

/**
 * @param {string} key - A property name.
 * @returns {string} Lower case text without `_` and `-`.
 */
function normalize(key) {
  return key.toLowerCase().replaceAll(/[_-]/g, '');
}

/**
 * @param {string} key - A property name.
 * @returns {boolean} True when the name looks like a secret or personal data.
 */
function isSecretKey(key) {
  return SECRET_KEYS.has(normalize(key));
}

/**
 * @param {import('estree').Property} property - An object property.
 * @returns {string | undefined} The static key name, or undefined for a computed key.
 */
function keyName(property) {
  const { key } = property;
  if (key.type === 'Identifier' && !property.computed) {
    return key.name;
  }
  return key.type === 'Literal' && typeof key.value === 'string' ? key.value : undefined;
}

/** @type {import('eslint').Rule.RuleModule} */
export const noSecretInLog = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Ban secret and personal-data keys in the object argument of a logger call.',
    },
    schema: [],
    messages: {
      secretKey:
        'Log field "{{key}}" can hold a secret or personal data. Do not log it. The logger redact list is the second layer, not the first.',
    },
  },
  create(context) {
    /**
     * Checks the keys of an object literal. Walks into nested object literals.
     *
     * @param {import('estree').ObjectExpression} object - A log object.
     */
    function checkObject(object) {
      for (const property of object.properties) {
        if (property.type !== 'Property') {
          continue; // Spread: the keys are not known.
        }
        const name = keyName(property);
        if (name !== undefined && isSecretKey(name)) {
          context.report({ node: property.key, messageId: 'secretKey', data: { key: name } });
        }
        if (property.value.type === 'ObjectExpression') {
          checkObject(property.value);
        }
      }
    }

    return {
      CallExpression(node) {
        const { callee } = node;
        if (
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.property.type !== 'Identifier' ||
          !LOG_METHODS.has(callee.property.name)
        ) {
          return;
        }
        for (const argument of node.arguments) {
          if (argument.type === 'ObjectExpression') {
            checkObject(argument);
          }
        }
      },
    };
  },
};

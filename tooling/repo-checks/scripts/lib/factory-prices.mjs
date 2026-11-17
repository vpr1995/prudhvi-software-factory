// Model prices for the cost script (design factory-daily-run 4.6, R-33). US dollars for each million
// tokens: the API-equivalent price, not the bill of a subscription. Source: the price list of the
// Claude API skill (cached 2026-11-03) for `input` and `output`. A cache read price that the list
// names (Opus 5.5, Sonnet 5.5, Fable 5.2) is used as it is. For each other model a cache read costs
// 0.1 times the input price, and a cache write costs 1.25 times the input price (the 5 minute write).
// A write with a 1 hour life costs 2 times the input price: the script prices it as a 5 minute write.
// A model that is not in this table has no price: the cost script then writes `null` and a warning.
// A new model is one line in the table.
const PRICES = new Map([
  ['claude-fable-5-2', { input: 8, output: 40, cacheWrite: 10, cacheRead: 0.2 }],
  ['claude-opus-5-5', { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 }],
  ['claude-opus-5', { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }],
  ['claude-opus-4-8', { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }],
  ['claude-opus-4-7', { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }],
  ['claude-opus-4-6', { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }],
  ['claude-sonnet-5-5', { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 }],
  ['claude-sonnet-5', { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 }],
  ['claude-sonnet-4-6', { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 }],
  ['claude-haiku-4-5', { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 }],
]);

// A context size suffix (`[1m]`) and a date suffix (`-20261101`) are not part of the model.
const CONTEXT_SUFFIX = /\[\d+[km]\]$/;
const DATE_SUFFIX = /-\d{8}$/;

/**
 * @param {string} model - The `message.model` text of a transcript line.
 * @returns {{ input: number, output: number, cacheWrite: number, cacheRead: number } | undefined}
 *   The prices for each million tokens, or undefined for a model that has no price.
 */
export function priceOf(model) {
  return PRICES.get(model.replace(CONTEXT_SUFFIX, '').replace(DATE_SUFFIX, ''));
}

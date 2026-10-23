// Schema parts with error messages that tell the owner how to fix the value. Zod's default
// messages ("Too small: expected number to be >0") do not say what to do.
import { z } from 'zod';

/**
 * Writes a list of names for a message, for example `"a", "b"`.
 *
 * @param names - The names.
 * @returns The names in quotes, joined with commas.
 */
const quoteAll = (names: readonly PropertyKey[]): string =>
  names.map((name) => `"${String(name)}"`).join(', ');

/**
 * An object that accepts only the given fields. The message of an unknown field names the field and
 * lists the allowed fields, so a typo like `ratng` is easy to fix.
 *
 * @param shape - The fields.
 * @param name - What the object is, for the message when the value is not an object, for example `a trip`.
 * @returns The schema.
 */
export function strictObject<Shape extends z.core.$ZodLooseShape>(
  shape: Shape,
  name: string,
): z.ZodObject<Shape, z.core.$strict> {
  const allowed = quoteAll(Object.keys(shape));
  return z.strictObject(shape, {
    error: (issue) =>
      issue.code === 'unrecognized_keys'
        ? `Remove or rename the unknown field ${quoteAll(issue.keys)}. The allowed fields are ${allowed}.`
        : `Write ${name} as an object in curly braces { }.`,
  });
}

/**
 * A text that is not empty and has at most `max` characters.
 *
 * @param max - The largest number of characters.
 * @param emptyMessage - The message for an empty text.
 * @returns The schema.
 */
export function text(
  max: number,
  emptyMessage = 'Write some text, or remove the field.',
): z.ZodString {
  return z
    .string({ error: 'Write the text in double quotes, for example "Golden light".' })
    .trim()
    .min(1, emptyMessage)
    .max(max, `Use at most ${String(max)} characters.`);
}

/**
 * A list with at most `max` items.
 *
 * @param item - The schema of one item.
 * @param max - The largest number of items.
 * @param noun - What the items are, for the message, for example `photos`.
 * @returns The schema.
 */
export function list<Item extends z.ZodType>(
  item: Item,
  max: number,
  noun: string,
): z.ZodArray<Item> {
  return z
    .array(item, { error: `Write the ${noun} as a list in square brackets [ ].` })
    .max(max, `Use at most ${String(max)} ${noun}.`);
}

/**
 * Finds the items of a list that are the same as an item before them.
 *
 * @param items - The items.
 * @param keyOf - Gives the value that must be unique.
 * @returns The index of each repeated item.
 */
export function findRepeats<Item>(
  items: readonly Item[],
  keyOf: (item: Item) => string,
): readonly number[] {
  const seen = new Set<string>();
  const repeats: number[] = [];
  for (const [index, item] of items.entries()) {
    const key = keyOf(item);
    if (seen.has(key)) {
      repeats.push(index);
    }
    seen.add(key);
  }
  return repeats;
}

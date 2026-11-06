// Minimal JSONC parser: removes comments and trailing commas, then calls JSON.parse.
// Same logic as tooling/tsconfig/scripts/check-tsconfigs.mjs. CI runs both scripts with no install,
// so neither can import the other through a package.

// Return the index after the string that starts at `start`.
function stringEnd(text, start) {
  let position = start + 1;
  while (position < text.length && text[position] !== '"') {
    position += text[position] === '\\' ? 2 : 1;
  }
  return position + 1;
}

// Return the index after the comment that starts at `start`. Return -1 when there is no comment.
function commentEnd(text, start) {
  const marker = text.slice(start, start + 2);
  if (marker === '//') {
    const lineEnd = text.indexOf('\n', start);
    return lineEnd === -1 ? text.length : lineEnd;
  }
  if (marker === '/*') {
    const close = text.indexOf('*/', start + 2);
    return close === -1 ? text.length : close + 2;
  }
  return -1;
}

function stripComments(text) {
  let output = '';
  let position = 0;
  while (position < text.length) {
    const end = text[position] === '"' ? stringEnd(text, position) : commentEnd(text, position);
    if (end === -1) {
      output += text[position];
      position += 1;
    } else {
      output += text[position] === '"' ? text.slice(position, end) : ' ';
      position = end;
    }
  }
  return output;
}

// A comma is trailing when only white space follows it, then "}" or "]".
function isTrailingComma(text, start) {
  let position = start + 1;
  while (position < text.length && /\s/.test(text[position])) position += 1;
  return text[position] === '}' || text[position] === ']';
}

// Input has no comments here. Skip strings so a "," inside a string stays.
function removeTrailingCommas(text) {
  let output = '';
  let position = 0;
  while (position < text.length) {
    if (text[position] === '"') {
      const end = stringEnd(text, position);
      output += text.slice(position, end);
      position = end;
    } else {
      if (text[position] !== ',' || !isTrailingComma(text, position)) output += text[position];
      position += 1;
    }
  }
  return output;
}

/** Parse JSONC text. String contents stay as they are. */
export function parseJsonc(text) {
  return JSON.parse(removeTrailingCommas(stripComments(text)));
}

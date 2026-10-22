// Tells whether inline code from an interpreter (python -c, node -e, ruby -e, perl -e, php -r,
// deno, bun, lua) can write, delete, move or link a file, or run a command. Code that only names a
// gate path to read it is not write-capable. Anything that runs a command or builds a call at run
// time counts as write-capable.

const WRITE_API = [
  /write(?:File|Text|Bytes|Sync|lines|_text|_bytes|All|v)\w*/,
  /(?<!stdout\.)(?<!stderr\.)\.write\s*\(/,
  /\b(?:File|IO|Bun|Pathname|FileUtils)\.\w*write\w*/,
  /\b(?:binwrite|syswrite|file_put_contents|fwrite|fputs)\b/,
  /append(?:File|_text)\w*|createWriteStream/,
  /\b(?:rm\w*|unlink\w*|remove\w*|rimraf|delete|trash)\b/,
  /rename\w*|\bmv\b|\bmove\w*|os\.replace|\bPath\b[^;\n]*\.replace\s*\(/,
  /copy\w*|\bcp(?:Sync)?\b|\bshutil\b|\bcp_r\b/,
  /truncate\w*|chmod\w*|chown\w*|chattr|utime\w*|futimes|\btouch\b|mkdir\w*|makedirs/,
  /symlink\w*|\blink(?:Sync)?\b|hardlink\w*|\bln\b/,
  /\bmode\s*=\s*['"][rbtU]*[wax+][rbtU+]*['"]|\bflags?\s*:\s*['"][rbtU]*[wax+][rbtU+]*['"]/,
  /WRONLY|RDWR|O_APPEND|O_TRUNC|O_CREAT|File::APPEND/,
  /\b(?:shelve|dbm|sqlite3|fileinput|FileHandler|ZipFile|TarFile|basicConfig)\b/,
  /exec|spawn|system|popen|subprocess|child_process|Popen|\bqx\b|%x/,
  /\]\s*\(|\bgetattr\b|__import__|importlib|\beval\b|\bFunction\b|\bReflect\b|\bglobals\b|\bbuiltins\b/,
];
const BACKTICK_COMMAND_NAME = /^(?:perl|ruby|php)$/;
const OPEN_CALL = /\bopen\w*\s*\(/g;
const READ_ONLY_MODE = /^['"](?:[rbtU]*|<.*)['"]$/;
const WRITE_MODE = /^['"][rbtU]*[wax+][rbtU+]*['"]$/;
const KEYWORD_ARGUMENT = /^(\w+)\s*=(?!=)\s*([\s\S]*)$/;
const MODE_KEYWORDS = new Set(['mode', 'flag', 'flags']);
const OPENERS = new Set(['(', '[', '{']);
const CLOSERS = new Set([')', ']', '}']);

/**
 * Finds the end of a quoted string.
 *
 * @param {string} code - The code.
 * @param {number} start - Index of the opening quote.
 * @returns {number} Index of the closing quote (the last index when the string does not end).
 */
function stringEnd(code, start) {
  const quote = code[start];
  for (let index = start + 1; index < code.length; index += 1) {
    if (code[index] === '\\') {
      index += 1;
    } else if (code[index] === quote) {
      return index;
    }
  }
  return code.length - 1;
}

/**
 * Reads the arguments of a call. It splits at commas that are not inside quotes or brackets.
 *
 * @param {string} code - The code.
 * @param {number} start - Index of the first character after the opening parenthesis.
 * @returns {string[] | null} The arguments, or null when the closing parenthesis is missing.
 */
function callArguments(code, start) {
  const args = [];
  let depth = 0;
  let current = '';
  for (let index = start; index < code.length; index += 1) {
    const char = code[index] ?? '';
    if (char === "'" || char === '"') {
      const end = stringEnd(code, index);
      current += code.slice(index, end + 1);
      index = end;
    } else if (depth === 0 && char === ')') {
      return [...args, current].filter((argument) => argument.trim() !== '');
    } else if (depth === 0 && char === ',') {
      args.push(current);
      current = '';
    } else {
      depth += (OPENERS.has(char) ? 1 : 0) - (CLOSERS.has(char) ? 1 : 0);
      current += char;
    }
  }
  return null;
}

/**
 * Tells whether the arguments of an `open` call can open a file for writing. A call with a second
 * positional argument, or a `mode` or `flags` keyword, counts unless the value is a read-only mode
 * written as a string (`'r'`, `'rb'`). A number or a variable is a flag that we cannot read.
 *
 * @param {string[]} args - Arguments of the call.
 * @returns {boolean} True when the call can write.
 */
function openCanWrite(args) {
  const positional = [];
  for (const argument of args) {
    const keyword = KEYWORD_ARGUMENT.exec(argument.trim());
    if (keyword === null) {
      positional.push(argument.trim());
    } else if (
      MODE_KEYWORDS.has(keyword[1] ?? '') &&
      !READ_ONLY_MODE.test((keyword[2] ?? '').trim())
    ) {
      return true;
    }
  }
  const mode = positional[1];
  if (mode !== undefined) {
    return !READ_ONLY_MODE.test(mode);
  }
  return positional.length === 1 && WRITE_MODE.test(positional[0] ?? '');
}

/**
 * Tells whether the code calls an `open` function in a way that can write.
 *
 * @param {string} code - The code.
 * @returns {boolean} True when an open call can write. An open call that does not end counts too.
 */
function opensForWrite(code) {
  for (const match of code.matchAll(OPEN_CALL)) {
    const args = callArguments(code, match.index + match[0].length);
    if (args === null || openCanWrite(args)) {
      return true;
    }
  }
  return false;
}

/**
 * Tells whether inline interpreter code can change files or run commands.
 *
 * @param {string} code - Inline code.
 * @param {string} interpreter - Program name (`python3`, `node`, `perl`).
 * @returns {boolean} True when the code is write-capable.
 */
export function canWrite(code, interpreter) {
  return (
    WRITE_API.some((pattern) => pattern.test(code)) ||
    opensForWrite(code) ||
    (BACKTICK_COMMAND_NAME.test(interpreter) && code.includes('`'))
  );
}

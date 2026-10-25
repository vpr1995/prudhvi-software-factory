// Tests for lib/rush-json-compare.mjs: the check that a new text of rush.json only adds the project
// entries that register-project.mjs writes. A removal, a repoint and an edit of an old entry must
// all give null.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rushJsonAddedProjects } from '../lib/rush-json-compare.mjs';

const ENTRY_A = `{
      "packageName": "@t/a",
      "projectFolder": "projects/a", // keep
      "tags": ["project/a"]
    }`;
const ENTRY_B = '{ "packageName": "@t/b", "projectFolder": "projects/b" }';

const BEFORE = `{
  // Rush settings. The "projects" word in this comment must not confuse the check.
  "rushVersion": "5.100.0",
  "pnpmVersion": "9.0.0",
  "other": { "projects": ["nested"] },
  "projects": [
    ${ENTRY_A},
    ${ENTRY_B}
  ],
  "tail": "x"
}
`;

/**
 * Makes the entry that register-project.mjs writes (one line, or the format of the script).
 *
 * @param {string} name - Project name.
 * @returns {string} The entry text.
 */
const added = (name) =>
  `{
      "packageName": "@vprprudhvi/${name}",
      "projectFolder": "projects/${name}",
      "shouldPublish": false,
      "tags": ["project/${name}"]
    }`;
const addedOneLine = (name) =>
  `{ "packageName": "@vprprudhvi/${name}", "projectFolder": "projects/${name}", "shouldPublish": false, "tags": ["project/${name}"] }`;

// The real array starts a line (two spaces). The nested "projects" key of "other" does not.
const withProjects = (entries, base = BEFORE) =>
  base.replace(
    /^ {2}"projects": \[[\s\S]*?\n {2}\],/m,
    () => `  "projects": [\n    ${entries.join(',\n    ')}\n  ],`,
  );

describe('rushJsonAddedProjects: pure additions', () => {
  it('names the project that an entry adds, in each place of the array', () => {
    assert.deepEqual(rushJsonAddedProjects(BEFORE, withProjects([ENTRY_A, ENTRY_B, added('cc')])), [
      'cc',
    ]);
    assert.deepEqual(rushJsonAddedProjects(BEFORE, withProjects([ENTRY_A, added('cc'), ENTRY_B])), [
      'cc',
    ]);
    assert.deepEqual(rushJsonAddedProjects(BEFORE, withProjects([added('cc'), ENTRY_A, ENTRY_B])), [
      'cc',
    ]);
  });

  it('accepts the one-line form of the entry (white space is not part of the check)', () => {
    assert.deepEqual(
      rushJsonAddedProjects(BEFORE, withProjects([ENTRY_A, ENTRY_B, addedOneLine('cc')])),
      ['cc'],
    );
  });

  it('names every added project', () => {
    assert.deepEqual(
      rushJsonAddedProjects(BEFORE, withProjects([ENTRY_A, added('cc'), ENTRY_B, added('dd-1')])),
      ['cc', 'dd-1'],
    );
  });
});

describe('rushJsonAddedProjects: no addition', () => {
  it('is null for the same text', () => {
    assert.equal(rushJsonAddedProjects(BEFORE, BEFORE), null);
  });

  it('is null when only a comment inside the projects array changes', () => {
    assert.equal(rushJsonAddedProjects(BEFORE, BEFORE.replace('// keep', '// changed')), null);
  });
});

describe('rushJsonAddedProjects: removal (F1)', () => {
  it('is null when an old entry is removed', () => {
    assert.equal(rushJsonAddedProjects(BEFORE, withProjects([ENTRY_B])), null);
    assert.equal(rushJsonAddedProjects(BEFORE, withProjects([ENTRY_A])), null);
  });

  it('is null when every entry is removed, and when the array becomes empty', () => {
    assert.equal(rushJsonAddedProjects(BEFORE, withProjects([])), null);
    assert.equal(rushJsonAddedProjects(withProjects([]), BEFORE), null);
  });

  it('is null when an entry is removed and another is added in the same change', () => {
    assert.equal(rushJsonAddedProjects(BEFORE, withProjects([ENTRY_A, added('cc')])), null);
  });

  it('is null when an old entry is commented out', () => {
    const after = BEFORE.replace(ENTRY_B, `/* ${ENTRY_B} */`).replace(
      '  ],',
      `    ,${added('cc')}\n  ],`,
    );
    assert.equal(rushJsonAddedProjects(BEFORE, after), null);
  });
});

describe('rushJsonAddedProjects: repoint and edit (F1)', () => {
  it('is null when an old entry gets another folder (repoint)', () => {
    const after = withProjects([ENTRY_A, ENTRY_B.replace('projects/b', 'projects/elsewhere')]);
    assert.equal(rushJsonAddedProjects(BEFORE, after), null);
    const together = withProjects([
      ENTRY_A,
      ENTRY_B.replace('projects/b', 'projects/elsewhere'),
      added('cc'),
    ]);
    assert.equal(rushJsonAddedProjects(BEFORE, together), null);
  });

  it('is null when an old entry gets another package name', () => {
    const after = withProjects([ENTRY_A, ENTRY_B.replace('@t/b', '@evil/b'), added('cc')]);
    assert.equal(rushJsonAddedProjects(BEFORE, after), null);
  });

  it('is null when a value inside an old entry changes', () => {
    const after = withProjects([ENTRY_A.replace('"project/a"', '"project/a", "extra"'), ENTRY_B]);
    assert.equal(rushJsonAddedProjects(BEFORE, after), null);
    const together = withProjects([
      ENTRY_A.replace('"project/a"', '"project/a", "extra"'),
      ENTRY_B,
      added('cc'),
    ]);
    assert.equal(rushJsonAddedProjects(BEFORE, together), null);
  });

  it('is null when a comment inside an old entry changes with an added entry', () => {
    const after = withProjects([ENTRY_A.replace('// keep', '// changed'), ENTRY_B, added('cc')]);
    assert.equal(rushJsonAddedProjects(BEFORE, after), null);
  });

  it('is null when a key is added to an old entry', () => {
    const after = withProjects([
      ENTRY_A,
      ENTRY_B.replace('}', ', "shouldPublish": true }'),
      added('cc'),
    ]);
    assert.equal(rushJsonAddedProjects(BEFORE, after), null);
  });

  it('is null when the old entries are in another order', () => {
    assert.equal(
      rushJsonAddedProjects(BEFORE, withProjects([ENTRY_B, ENTRY_A, added('cc')])),
      null,
    );
  });
});

describe('rushJsonAddedProjects: the shape of an added entry', () => {
  const nullFor = (entry) =>
    assert.equal(
      rushJsonAddedProjects(BEFORE, withProjects([ENTRY_A, ENTRY_B, entry])),
      null,
      entry,
    );

  it('is null for another package scope, folder root, tag or shouldPublish value', () => {
    nullFor(added('cc').replace('@vprprudhvi/', '@evil/'));
    nullFor(added('cc').replace('"projects/cc"', '"packages/cc"'));
    nullFor(added('cc').replace('"projects/cc"', '"projects/cc/sub"'));
    nullFor(added('cc').replace('"projects/cc"', '"projects/../tooling/cc"'));
    nullFor(added('cc').replace('project/cc', 'project/other'));
    nullFor(added('cc').replace('false', 'true'));
  });

  it('is null when the package name does not fit the folder', () => {
    nullFor(added('cc').replace('@vprprudhvi/cc', '@vprprudhvi/other'));
  });

  it('is null for a bad project name', () => {
    nullFor(added('CC'));
    nullFor(added('c'));
    nullFor(added('1c'));
    nullFor(added('c_c'));
    nullFor(added(`c${'c'.repeat(41)}`));
  });

  it('is null for a name that the dependency scan ignores as a folder (N2)', () => {
    // These names fit the project name rule or are close to it. The typosquat scan skips every
    // folder with such a name, so a project with one would hide its package.json from the scan.
    nullFor(added('dist'));
    nullFor(added('node_modules'));
    nullFor(added('.next'));
    assert.deepEqual(
      rushJsonAddedProjects(BEFORE, withProjects([ENTRY_A, ENTRY_B, added('dist-x')])),
      ['dist-x'],
    );
  });

  it('is null for an extra key, a missing key, or keys in another order', () => {
    nullFor(added('cc').replace('"tags"', '"extra": 1, "tags"'));
    nullFor(added('cc').replace('      "shouldPublish": false,\n', ''));
    nullFor(
      `{ "projectFolder": "projects/cc", "packageName": "@vprprudhvi/cc", "shouldPublish": false, "tags": ["project/cc"] }`,
    );
  });

  it('is null for a repeated key (the last one would win when parsed)', () => {
    nullFor(
      `{ "packageName": "@vprprudhvi/cc", "projectFolder": "projects/x", "projectFolder": "projects/cc", "shouldPublish": false, "tags": ["project/cc"] }`,
    );
  });

  it('is null for an entry that is not an object, or an escaped key', () => {
    nullFor('"projects/cc"');
    nullFor(added('cc').replace('"packageName"', '"package\\u004eame"'));
  });

  it('is null when an added entry repeats a name or a folder of the array', () => {
    assert.equal(
      rushJsonAddedProjects(BEFORE, withProjects([ENTRY_A, ENTRY_B, added('cc'), added('cc')])),
      null,
    );
    const folderTaken = ENTRY_B.replace('projects/b', 'projects/dd');
    const before = withProjects([ENTRY_A, folderTaken]);
    assert.deepEqual(
      rushJsonAddedProjects(before, withProjects([ENTRY_A, folderTaken, added('cc')], before)),
      ['cc'],
    );
    assert.equal(
      rushJsonAddedProjects(before, withProjects([ENTRY_A, folderTaken, added('dd')], before)),
      null,
    );
    const nameTaken = ENTRY_B.replace('@t/b', '@vprprudhvi/dd');
    const named = withProjects([ENTRY_A, nameTaken]);
    assert.equal(
      rushJsonAddedProjects(named, withProjects([ENTRY_A, nameTaken, added('dd')], named)),
      null,
    );
  });
});

describe('rushJsonAddedProjects: the rest of the file', () => {
  const plus = withProjects([ENTRY_A, ENTRY_B, added('cc')]);

  it('is null when a key outside projects changes', () => {
    assert.equal(rushJsonAddedProjects(BEFORE, plus.replace('"5.100.0"', '"5.101.0"')), null);
    assert.equal(rushJsonAddedProjects(BEFORE, plus.replace('"tail": "x"', '"tail": "y"')), null);
  });

  it('is null when a key is added or removed outside projects', () => {
    assert.equal(
      rushJsonAddedProjects(BEFORE, plus.replace('"tail": "x"', '"tail": "x", "added": 1')),
      null,
    );
    assert.equal(
      rushJsonAddedProjects(BEFORE, plus.replace('  "pnpmVersion": "9.0.0",\n', '')),
      null,
    );
  });

  it('is null when a comment or white space outside projects changes', () => {
    assert.equal(
      rushJsonAddedProjects(BEFORE, plus.replace('// Rush settings.', '// Other settings.')),
      null,
    );
    assert.equal(rushJsonAddedProjects(BEFORE, plus.replace('"tail"', '  "tail"')), null);
  });

  it('is null when the nested "projects" key changes (it is not the top-level array)', () => {
    assert.equal(
      rushJsonAddedProjects(BEFORE, plus.replace('["nested"]', '["nested", "more"]')),
      null,
    );
  });

  it('is null when a second top-level projects key is added, also when it is escaped', () => {
    assert.equal(
      rushJsonAddedProjects(BEFORE, plus.replace('"tail": "x"', '"tail": "x", "projects": []')),
      null,
    );
    assert.equal(
      rushJsonAddedProjects(
        BEFORE,
        plus.replace('"tail": "x"', '"tail": "x", "\\u0070rojects": []'),
      ),
      null,
    );
  });

  it('is null when the new text is not valid JSONC', () => {
    assert.equal(rushJsonAddedProjects(BEFORE, `${plus}}`), null);
    assert.equal(rushJsonAddedProjects(BEFORE, plus.replace('"tail": "x"', '"tail": ')), null);
  });

  it('is null when the old text is not valid JSONC', () => {
    assert.equal(rushJsonAddedProjects('{', plus), null);
  });

  it('is null when projects is not an array of objects', () => {
    for (const projects of ['"x"', '["x"]', '[[]]', 'null']) {
      const after = BEFORE.replace(
        /^ {2}"projects": \[[\s\S]*?\n {2}\],/m,
        () => `  "projects": ${projects},`,
      );
      assert.equal(rushJsonAddedProjects(BEFORE, after), null, projects);
    }
  });

  it('is null when a text has no projects array, and for empty texts', () => {
    assert.equal(rushJsonAddedProjects('{}', '{}'), null);
    assert.equal(rushJsonAddedProjects(BEFORE, '{ "rushVersion": "5.100.0" }'), null);
    assert.equal(rushJsonAddedProjects('', ''), null);
  });
});

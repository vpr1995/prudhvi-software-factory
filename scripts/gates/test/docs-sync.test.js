// Keeps docs/standards/gates.md and the gate-writing skills in step with gate-files.json.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { matchesGlob } from '../lib/glob.mjs';

import { GATES, REPOSITORY } from './harness.js';

const gateFiles = JSON.parse(fs.readFileSync(path.join(GATES, 'gate-files.json'), 'utf8'));
const gateGlobs = gateFiles.gates.map((gate) => gate.glob);
const gatesDocument = fs.readFileSync(
  path.join(REPOSITORY, 'docs', 'standards', 'gates.md'),
  'utf8',
);

const SKILLS = ['new-project', 'add-project-part', 'new-shared-package'];
const SAMPLE = { name: 'sample', part: 'api', pkg: 'sample-pkg' };

/**
 * Returns the backticked text of each row in the first table under a heading.
 *
 * @param {string} markdown - Document text.
 * @param {string} heading - Heading text that starts with the section number.
 * @returns {string[]} First backticked span of each table row.
 */
function firstColumnGlobs(markdown, heading) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`### ${heading}`));
  assert.notEqual(start, -1, `missing heading: ${heading}`);
  const end = lines.findIndex((line, index) => index > start && /^#{2,3} /.test(line));
  const rows = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .filter((line) => line.startsWith('|'));
  return rows.map((row) => /`([^`]+)`/.exec(row.split('|')[1] ?? '')?.[1]).filter(Boolean);
}

/**
 * Splits a SKILL.md body at its level-2 headings. Drops the frontmatter.
 *
 * @param {string} markdown - Skill text.
 * @returns {{ title: string, body: string }[]} Sections. The first has an empty title.
 */
function sectionsOf(markdown) {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, '');
  const parts = body.split(/^## (.+)$/m);
  const sections = [{ title: '', body: parts[0] ?? '' }];
  for (let index = 1; index < parts.length; index += 2) {
    sections.push({ title: (parts[index] ?? '').trim(), body: parts[index + 1] ?? '' });
  }
  return sections;
}

/**
 * Fills the placeholders of a path so that gate globs can match it.
 *
 * @param {string} token - Backticked text from a skill.
 * @returns {string} Path with sample values in place of `<name>`, `<part>` and `<pkg>`.
 */
function normalize(token) {
  return token
    .replaceAll('<name>', SAMPLE.name)
    .replaceAll('<part>', SAMPLE.part)
    .replaceAll('<pkg>', SAMPLE.pkg)
    .replaceAll(/<[^>]+>/g, 'x');
}

/**
 * Tells whether a backticked token looks like a file path.
 *
 * @param {string} token - Backticked text.
 * @returns {boolean} True for a one-word file path with a slash or a dot. Folders end in a slash.
 */
function isPathLike(token) {
  return !/\s/.test(token) && /[./]/.test(token) && !token.startsWith('-') && !token.endsWith('/');
}

/**
 * Lists the backticked paths in a text.
 *
 * @param {string} text - Markdown text.
 * @returns {string[]} Normalized path-like tokens.
 */
function pathsIn(text) {
  return [...text.matchAll(/`([^`\n]+)`/g)]
    .map((match) => match[1] ?? '')
    .filter(isPathLike)
    .map(normalize);
}

/**
 * Parses one skill into the paths it names outside the Do not and Handoff sections.
 *
 * @param {string} name - Skill folder name.
 * @returns {{ handoff: string[], handoffText: string, hasHandoffSection: boolean,
 *   gated: { token: string, rule: string }[] }} Handoff paths, raw handoff text, and gated mentions.
 */
function parseSkill(name) {
  const file = path.join(REPOSITORY, '.claude', 'skills', name, 'SKILL.md');
  const text = fs.readFileSync(file, 'utf8');
  const sections = sectionsOf(text);
  const handoffText = sections
    .filter((section) => /^Handoff files\b/.test(section.title))
    .map((section) => section.body)
    .join('\n');
  const scanText = sections
    .filter(
      (section) => !/^Do not\b/.test(section.title) && !/^Handoff files\b/.test(section.title),
    )
    .map((section) => section.body)
    .join('\n');
  const writesPhaseKeys = scanText.includes('_phase:');
  const gated = [];
  for (const token of pathsIn(scanText)) {
    const glob = gateGlobs.find((pattern) => matchesGlob(token, pattern));
    if (glob) {
      gated.push({ token, rule: glob });
    } else if (path.posix.basename(token) === 'package.json' && writesPhaseKeys) {
      gated.push({ token, rule: 'package.json with _phase:* scripts' });
    }
  }
  return {
    handoff: pathsIn(handoffText),
    handoffText,
    hasHandoffSection: handoffText !== '',
    gated,
  };
}

describe('gates.md lists the gate files in gate-files.json', () => {
  const table = firstColumnGlobs(gatesDocument, '2.1');

  it('names every gate glob in backticks', () => {
    const missing = gateGlobs.filter((glob) => !gatesDocument.includes(`\`${glob}\``));
    assert.deepEqual(missing, [], `gates.md does not name: ${missing.join(', ')}`);
  });

  it('has a section 2.1 row for each gate glob, and no other row', () => {
    const missing = gateGlobs.filter((glob) => !table.includes(glob));
    const extra = table.filter((glob) => !gateGlobs.includes(glob));
    assert.deepEqual({ missing, extra }, { missing: [], extra: [] });
  });

  it('has no duplicate row in section 2.1', () => {
    const duplicates = table.filter((glob, index) => table.indexOf(glob) !== index);
    assert.deepEqual(duplicates, []);
  });

  it('has the gate integrity check and known limits sections', () => {
    assert.match(gatesDocument, /^#{2,3} .*Gate integrity check/m);
    assert.match(gatesDocument, /^#{2,3} .*Known limits/m);
  });
});

describe('gate-writing skills send gate files to the handoff folder', () => {
  for (const name of SKILLS) {
    describe(name, () => {
      const skill = parseSkill(name);

      it('has a Handoff files section that names the handoff folder', () => {
        assert.ok(skill.hasHandoffSection, 'missing "## Handoff files" section');
        assert.ok(
          skill.handoffText.includes('.claude/state/handoff/'),
          'Handoff files section must name .claude/state/handoff/',
        );
      });

      it('names at least one gated path, so the check is not empty', () => {
        assert.ok(skill.gated.length > 0, 'no gated path found in the skill text');
      });

      it('lists every gated path it mentions in Handoff files', () => {
        const missing = skill.gated.filter(
          ({ token }) =>
            !skill.handoff.some((entry) => entry === token || entry.endsWith(`/${token}`)),
        );
        assert.deepEqual(
          missing.map(({ token, rule }) => `${token} (${rule})`),
          [],
          'gated paths that are not in the Handoff files list',
        );
      });
    });
  }
});

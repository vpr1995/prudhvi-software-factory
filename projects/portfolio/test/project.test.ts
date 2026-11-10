import { describe, expect, it } from 'vitest';

import manifest from '../package.json' with { type: 'json' };

// A project with no part still has one test, because Vitest fails when it finds no test.
describe('project', () => {
  it('has the Rush project name', () => {
    expect(manifest.name).toBe('@vprprudhvi/portfolio');
  });
});

// Routing table of the factory review router (design factory-daily-run 4.2).
// It is the code copy of the tier tables in docs/standards/risk-tiers.md sections 2 and 2.1.
// test/factory-route.test.js fails when the two differ (R-22). Test files: isTestFile of
// lib/test-guard-rules.mjs. This table keeps no test glob list.
export const routing = {
  docOnly: ['**/*.md'],
  docOnlyExclude: ['**/CLAUDE.md', '**/REVIEW.md', '.claude/**', '.github/**'],
  excludeFromCount: ['common/config/rush/pnpm-lock.yaml', '**/*.generated.*'],
  tiers: {
    high: [
      'platform/**',
      'packages/**',
      'tooling/**',
      '.github/**',
      'projects/*/cdk.json',
      'common/config/rush/pnpm-lock.yaml',
      '**/auth/**',
    ],
    medium: [
      'projects/*/bin/**',
      'projects/*/lib/**',
      '**/CLAUDE.md',
      '**/REVIEW.md',
      'docs/guides/**',
      'docs/standards/**',
    ],
  },
  // A path in no tier: low when doc-only or a test file (isTestFile), else medium.
  // `when`: 'always', 'code-change', or a glob list. Any other value cannot decide: the pass runs (R-19).
  passes: {
    'spec-reviewer': { when: 'always', model: 'opus' },
    'fresh-reviewer': { when: 'code-change', model: 'sonnet' },
    simplify: { when: 'code-change', model: 'session' },
    'security-reviewer': { when: 'code-change', model: 'tier' },
    'infra-reviewer': {
      when: ['projects/*/bin/**', 'projects/*/lib/**', 'platform/**', 'packages/cdk-constructs/**'],
      model: 'tier',
    },
  },
  models: { high: 'opus', default: 'sonnet' }, // "tier": opus on risk:high, else sonnet
  diffBudget: { 1: 150, 2: 300, 3: 500, 4: 800, 5: 800, missing: 800 },
};

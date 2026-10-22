import path from 'node:path';

import { exists, makeTemporaryDirectory, readJson, removePath, writeText } from './fs-io.mjs';
import { run, which } from './proc.mjs';

/**
 * @typedef {object} SecretFinding
 * @property {string} rule - Rule id.
 * @property {string} file - File name (repo-relative when known).
 * @property {number} line - 1-based line, or 0 when unknown.
 */

const LEAK_EXIT_CODE = 1;
const GITLEAKS_TIMEOUT_MS = 120_000;

/** Rules that mirror the default gitleaks rules and .gitleaks.toml. Used when gitleaks is missing. */
const FALLBACK_RULES = [
  { rule: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA|ABIA|ACCA|A3T[A-Z0-9])[A-Z2-7]{16}\b/ },
  {
    rule: 'aws-secret-access-key-assignment',
    pattern: /aws_?secret_?access_?key["'\s]*[:=]\s*["']?[A-Za-z0-9/+=]{40}["']?/i,
  },
  {
    rule: 'private-key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/,
  },
  { rule: 'jwt', pattern: /\bey[A-Za-z0-9_-]{10,}\.ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  {
    rule: 'github-token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/,
  },
  { rule: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { rule: 'stripe-live-key', pattern: /\b[sr]k_live_[A-Za-z0-9]{16,}/ },
  { rule: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
];
const ENV_SECRET_LINE =
  /^\s*[A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*["']?([A-Za-z0-9/+_\-=.]{16,})["']?\s*$/i;
const PLACEHOLDER = /^(?:changeme|example|placeholder|<[^>]+>|\$\{[^}]+\})$/i;

/**
 * Scans text with built-in patterns.
 *
 * @param {string} text - Content.
 * @param {string} file - File name for the report.
 * @returns {SecretFinding[]} Findings.
 */
export function regexFindings(text, file) {
  const findings = [];
  for (const [index, content] of text.split('\n').entries()) {
    for (const { rule, pattern } of FALLBACK_RULES) {
      const match = pattern.exec(content);
      const isDocumentationKey = match?.[0].endsWith('EXAMPLE') ?? false;
      if (match !== null && !isDocumentationKey) {
        findings.push({ rule, file, line: index + 1 });
      }
    }
    const envMatch = ENV_SECRET_LINE.exec(content);
    if (envMatch !== null && !PLACEHOLDER.test(envMatch[1] ?? '')) {
      findings.push({ rule: 'env-file-secret-value', file, line: index + 1 });
    }
  }
  return findings;
}

/**
 * Runs gitleaks on a set of in-memory files. Returns null when gitleaks is missing or fails.
 *
 * @param {string} root - Repo root (for .gitleaks.toml).
 * @param {{ file: string, text: string }[]} files - Files to scan. `file` is a repo-relative name.
 * @returns {SecretFinding[] | null} Findings, or null when gitleaks did not run.
 */
function gitleaksFindings(root, files) {
  const binary = which('gitleaks');
  if (binary === null) {
    return null;
  }
  const scratch = makeTemporaryDirectory('gate-secrets-');
  try {
    const tree = path.join(scratch, 'tree');
    const report = path.join(scratch, 'report.json');
    for (const entry of files) {
      writeText(path.join(tree, entry.file), entry.text);
    }
    const config = path.join(root, '.gitleaks.toml');
    const configArgs = exists(config) ? ['--config', config] : [];
    const flags = ['--no-banner', '--redact', '--log-level', 'error', '--report-format', 'json'];
    const result = run(
      binary,
      [
        'dir',
        tree,
        ...configArgs,
        ...flags,
        '--report-path',
        report,
        '--exit-code',
        String(LEAK_EXIT_CODE),
      ],
      { timeoutMs: GITLEAKS_TIMEOUT_MS },
    );
    const ran = result.status === 0 || result.status === LEAK_EXIT_CODE;
    return ran ? readReport(report, tree) : null;
  } finally {
    removePath(scratch);
  }
}

/**
 * Scans in-memory files for secrets. gitleaks runs when it is installed. The built-in patterns
 * always run too, so a missing or broken gitleaks never leaves the scan empty.
 *
 * @param {string} root - Repo root (for .gitleaks.toml).
 * @param {{ file: string, text: string }[]} files - Files to scan. `file` is a repo-relative name.
 * @returns {{ engine: 'gitleaks' | 'regex', findings: SecretFinding[] }} Result. The engine is
 *   `regex` when gitleaks did not run.
 */
export function scanFiles(root, files) {
  const external = gitleaksFindings(root, files);
  const builtin = files.flatMap((entry) => regexFindings(entry.text, entry.file));
  const seen = new Set(
    (external ?? []).map((finding) => `${finding.file}:${String(finding.line)}`),
  );
  const extra = builtin.filter((finding) => !seen.has(`${finding.file}:${String(finding.line)}`));
  return {
    engine: external === null ? 'regex' : 'gitleaks',
    findings: [...(external ?? []), ...extra],
  };
}

/**
 * Reads a gitleaks JSON report.
 *
 * @param {string} report - Report file.
 * @param {string} tree - The scanned folder, removed from file names.
 * @returns {SecretFinding[]} Findings.
 */
function readReport(report, tree) {
  const parsed = readJson(report);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.map((item) => ({
    rule: String(item.RuleID ?? 'unknown'),
    file: path.relative(tree, String(item.File ?? '')),
    line: Number(item.StartLine ?? 0),
  }));
}

/**
 * Formats findings for a message. It never prints the secret itself.
 *
 * @param {SecretFinding[]} findings - Findings.
 * @returns {string} One line per finding.
 */
export function formatFindings(findings) {
  return findings
    .map(
      (finding) =>
        `  ${finding.file}${finding.line > 0 ? `:${String(finding.line)}` : ''} rule ${finding.rule}`,
    )
    .join('\n');
}

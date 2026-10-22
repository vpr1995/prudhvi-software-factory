import { blockWith, editedPaths, proposedTexts, runHook } from '../lib/hook-io.mjs';
import { formatFindings, scanFiles } from '../lib/secrets.mjs';

runHook(
  (context) => {
    if (!context.parsed) {
      return blockWith('block-secrets: the hook input was not valid JSON, so the edit is blocked.');
    }
    const texts = proposedTexts(context.payload);
    if (texts.length === 0) {
      return { exitCode: 0 };
    }
    const target = editedPaths(context.payload)[0] ?? 'content.txt';
    const name = target.split('/').pop() ?? 'content.txt';
    const files = texts.map((text, index) => ({ file: `${String(index)}/${name}`, text }));
    const result = scanFiles(context.root, files);
    if (result.findings.length === 0) {
      return { exitCode: 0 };
    }
    return blockWith(
      `BLOCKED by block-secrets (${result.engine}): the new content of ${target} looks like it holds a secret.\n${formatFindings(result.findings)}\nDo not write secrets in files. Read them from the environment (Zod-parsed in config.ts) and use SSM or Secrets Manager. In Bruno use {{process.env.NAME}}. For a test value, build it so it does not look like a real key. If this is a false positive, stop and ask the human (they edit .gitleaks.toml).`,
    );
  },
  { failClosed: true, name: 'block-secrets' },
);

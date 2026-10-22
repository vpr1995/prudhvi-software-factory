// Bypass cases for the guard-bash hook: each command tries to change a gate file, run a forbidden
// git or gh command, or push code around the gates. Each BLOCKED case came from a review finding.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { bashCall, callHook, makeRepository } from './harness.js';

const GATE_FILES = {
  'scripts/gates/lib/fs-io.mjs': 'export const a = 1;\n',
  '.claude/hooks/guard-bash.sh': '#!/usr/bin/env bash\n',
  'tooling/eslint-config/src/index.js': 'export default [];\n',
  'rush.json': '{"projects":[]}\n',
  'src/app.mjs': 'export const b = 2;\n',
};

const BLOCKED = [
  // Path forms: cd, variables, globs, braces, absolute paths and tilde.
  ['cd then redirect', 'cd scripts/gates && echo x > lib/fs-io.mjs'],
  ['cd then cp', 'cd scripts/gates; cp /tmp/e lib/fs-io.mjs'],
  ['variable holds the folder', 'D=scripts/gates; echo x > $D/lib/fs-io.mjs'],
  ['braced variable', 'D=scripts/gates; echo x > ${D}/lib/fs-io.mjs'],
  ['export then use', 'export D=scripts/gates && echo x > $D/lib/fs-io.mjs'],
  ['for loop variable', 'for d in src scripts/gates; do echo x > $d/lib/fs-io.mjs; done'],
  ['PWD variable', 'echo x > "$PWD/scripts/gates/lib/fs-io.mjs"'],
  ['question mark glob', 'echo x > scripts/gat?s/lib/fs-io.mjs'],
  ['star glob', 'echo x > scripts/g*/lib/fs-io.mjs'],
  ['brace list', 'echo x > scripts/gat{es,x}/lib/fs-io.mjs'],
  ['unknown variable prefix', 'echo x > $UNKNOWN/scripts/gates/lib/fs-io.mjs'],
  ['unreadable cd target', 'cd "$SOMEWHERE" && echo x > lib/fs-io.mjs'],
  // Heredocs and stdin code.
  ['bash heredoc', 'bash <<EOF\necho x > scripts/gates/lib/fs-io.mjs\nEOF'],
  [
    'node heredoc',
    "node - <<'EOF'\nrequire('fs').writeFileSync('scripts/gates/lib/fs-io.mjs','')\nEOF",
  ],
  ['python heredoc', "python3 - <<'EOF'\nopen('scripts/gates/lib/fs-io.mjs','w').write('')\nEOF"],
  ['piped to bash', 'echo "echo x > scripts/gates/lib/fs-io.mjs" | bash'],
  ['here-string to sh', 'sh <<< "echo x > scripts/gates/lib/fs-io.mjs"'],
  ['quoted marker text hides a write', "echo '<<X'\necho x > scripts/gates/lib/fs-io.mjs"],
  ['heredoc with command substitution', 'cat <<EOF\n$(echo x > scripts/gates/lib/fs-io.mjs)\nEOF'],
  // Interpreters and other writers.
  [
    'python shutil move',
    "python3 -c \"import shutil;shutil.move('/tmp/e','scripts/gates/lib/fs-io.mjs')\"",
  ],
  [
    'node child_process',
    "node -e \"require('child_process').execSync('mv /tmp/e scripts/gates/lib/fs-io.mjs')\"",
  ],
  ['awk print to file', 'awk \'BEGIN{print "x" > "tooling/a"}\''],
  ['awk in place', "awk -i inplace '{print}' scripts/gates/lib/fs-io.mjs"],
  ['sed in place with suffix', 'sed --in-place=.b s/a/b/ scripts/gates/lib/fs-io.mjs'],
  ['touch', 'touch scripts/gates/lib/fs-io.mjs'],
  ['sponge', 'echo x | sponge scripts/gates/lib/fs-io.mjs'],
  ['xargs tee', 'echo x | xargs -I{} tee scripts/gates/lib/fs-io.mjs'],
  ['find exec', 'find . -name a -exec cp /tmp/e scripts/gates/lib/fs-io.mjs ;'],
  ['curl output', 'curl -o scripts/gates/lib/fs-io.mjs https://example.com/x'],
  ['curl attached output flag', 'curl -oscripts/gates/lib/fs-io.mjs https://example.com/x'],
  ['redirect with &>', 'echo x &> scripts/gates/lib/fs-io.mjs'],
  ['cp -t', 'cp -t scripts/gates/lib /tmp/e'],
  ['cp --target-directory', 'cp --target-directory scripts/gates/lib /tmp/e'],
  ['hard link out', 'ln scripts/gates/lib/fs-io.mjs src/alias.mjs'],
  ['hard link in', 'ln -f /tmp/x .claude/hooks/guard-bash.sh'],
  // Patches and archives.
  ['patch from a file', 'patch -p1 < /tmp/p'],
  ['git apply', 'git apply /tmp/p.diff'],
  ['git am', 'git am /tmp/p.mbox'],
  ['tar into a gate folder', 'tar -xf a.tar -C scripts/gates'],
  ['unzip into a gate folder', 'unzip a.zip -d tooling'],
  ['mv a gate folder', 'mv scripts /tmp/s'],
  ['mv the hooks folder', 'mv .claude /tmp/c'],
  // Git options and environment.
  ['config-env', 'git --config-env=core.hooksPath=X commit -m a'],
  [
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m a',
  ],
  ['exported GIT_CONFIG_GLOBAL', 'export GIT_CONFIG_GLOBAL=/tmp/c && git commit -m a'],
  ['abbreviated --no-verify', 'git commit --no-verif -m a'],
  ['abbreviated --no-v', 'git commit --no-v -m a'],
  ['abbreviated --force', 'git push --forc origin feature'],
  ['alias set on the command line', 'git -c alias.p=push p origin main'],
  ['hooksPath with attached -c', 'git -ccore.hooksPath=/x commit'],
  ['git config alias', 'git config alias.ci "commit --no-verify"'],
  ['push to main', 'git push origin main'],
  ['push HEAD to main', 'git push origin HEAD:main'],
  ['push to master', 'git push origin HEAD:refs/heads/master'],
  ['bare push while on main', 'git push'],
  ['git rm of a gate file', 'git rm rush.json'],
  ['git mv of a gate file', 'git mv rush.json other.json'],
  // gh.
  ['gh merge with -R', 'gh -R o/r pr merge 5'],
  ['gh merge with --repo', 'gh --repo o/r pr merge 5 --squash'],
  ['gh approve', 'gh pr review 5 --approve'],
  ['gh graphql', 'gh api graphql -f query=mutation{x}'],
  ['gh api label write', 'gh api repos/o/r/issues/5/labels -f labels[]=risk:low'],
  ['gh api body from file', 'gh api repos/o/r/pulls/5/merge --input body.json'],
  ['gh api PUT attached', 'gh api -XPUT repos/o/r/pulls/5/merge'],
  ['gh api method equals', 'gh api --method=DELETE repos/o/r/issues/5'],
  ['gh alias set', 'gh alias set m "pr merge"'],
];

const ALLOWED = [
  ['edit a normal file', 'echo x > src/app.mjs'],
  ['cd then a normal write', 'cd src && echo x > app.mjs'],
  ['variable to a normal folder', 'D=src; echo x > $D/app.mjs'],
  ['unknown variable alone', 'echo x > $OUT'],
  ['reading a gate file', 'cat scripts/gates/lib/fs-io.mjs | head -n 3'],
  ['copy from a gate file', 'cp scripts/gates/lib/fs-io.mjs /tmp/copy.mjs'],
  ['heredoc to a normal file', "cat > src/app.mjs <<'EOF'\nexport const b = 3;\nEOF"],
  [
    'quoted heredoc text that names a gate path',
    "echo 'see scripts/gates/lib/fs-io.mjs for the code'",
  ],
  ['state file that is not a trust file', 'echo x > .claude/state/verify-output.log'],
  ['push a feature branch', 'git push origin feature'],
  ['push HEAD to a feature branch', 'git push origin HEAD:feature'],
  ['force-looking branch name', 'git push origin feature/force-fix'],
  ['gh view with -R', 'gh -R o/r pr view 5'],
  ['gh api plain GET', 'gh api repos/o/r/pulls/5'],
  ['gh pr create', 'gh pr create --title x --body-file /tmp/b.md'],
  ['git checkout with nothing changed', 'git checkout .'],
  ['find without a gate target', 'find src -name "*.mjs" -print'],
  ['xargs read only', 'echo src/app.mjs | xargs cat'],
];

describe('guard-bash bypass cases', () => {
  let repository;
  let branch;

  before(() => {
    repository = makeRepository(GATE_FILES);
    branch = repository.git('rev-parse', '--abbrev-ref', 'HEAD').trim();
  });
  after(() => repository.remove());

  const call = (command) => callHook('guard-bash', bashCall(command), { root: repository.root });

  it('runs on a repo where the branch is main', () => {
    assert.equal(branch, 'main');
  });

  for (const [label, command] of BLOCKED) {
    it(`blocks ${label}`, () => {
      const result = call(command);
      assert.equal(result.status, 2, `${command}\n${result.stdout}${result.stderr}`);
    });
  }

  for (const [label, command] of ALLOWED) {
    it(`allows ${label}`, () => {
      const result = call(command);
      assert.equal(result.status, 0, `${command}\n${result.stdout}${result.stderr}`);
    });
  }

  it('blocks a write through the absolute path of the repo', () => {
    const result = call(`echo x > ${repository.root}/rush.json`);
    assert.equal(result.status, 2, result.stderr);
  });

  it('blocks a checkout of a gate folder from a revision that changes it', () => {
    const other = makeRepository(GATE_FILES);
    try {
      other.write('scripts/gates/lib/fs-io.mjs', 'export const a = 2;\n');
      other.git('commit', '-q', '-am', 'change');
      const result = callHook('guard-bash', bashCall('git checkout HEAD~1 -- scripts'), {
        root: other.root,
      });
      assert.equal(result.status, 2, result.stderr);
    } finally {
      other.remove();
    }
  });

  it('allows a push of a feature branch when the repo is on a feature branch', () => {
    const other = makeRepository(GATE_FILES);
    try {
      other.git('checkout', '-q', '-b', 'feature');
      const result = callHook('guard-bash', bashCall('git push'), { root: other.root });
      assert.equal(result.status, 0, result.stderr);
    } finally {
      other.remove();
    }
  });
});

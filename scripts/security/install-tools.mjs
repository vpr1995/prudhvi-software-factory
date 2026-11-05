// Runs after `rush install` (eventHooks.postRushInstall).
// Installs the non-npm binaries the git hooks and CI need: gitleaks, actionlint, zizmor, pinact.
// Each download is pinned and checked with sha256 before it is used.
// Env: CI or SKIP_TOOL_INSTALL=1 skips. INSTALL_TOOLS_DIR sets the install dir.
// CI jobs that need the tools run this script with CI set to an empty value.
// Checksum sources: the release checksums file (gitleaks, actionlint, pinact). zizmor has no
// checksums file: its sha256 is the GitHub release asset digest (the release also has attestations).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import {
  exists,
  isExecutableFile,
  makeDirectory,
  makeExecutable,
  makeTemporaryDirectory,
  movePath,
  realPath,
  removePath,
  writeBytes,
} from './lib/fs-io.mjs';
import { readEnv } from './lib/tools.config.mjs';

const PINS = {
  gitleaks: {
    version: '8.28.0',
    bin: 'gitleaks',
    versionArgs: ['version'],
    url: 'https://github.com/gitleaks/gitleaks/releases/download/v8.28.0/',
    archive: true, // tar.gz with a `gitleaks` binary inside
    hint: 'https://github.com/gitleaks/gitleaks/releases/tag/v8.28.0',
    assets: {
      'darwin-arm64': {
        file: 'gitleaks_8.28.0_darwin_arm64.tar.gz',
        sha256: 'd942f3ad147250c9edbaab3fed9e482f98d3b59ba10ae97b8d75647e3ade492c',
      },
      'darwin-x64': {
        file: 'gitleaks_8.28.0_darwin_x64.tar.gz',
        sha256: 'edf5a507008b0d2ef4959575772772770586409c1f6f74dabf19cbe7ec341ced',
      },
      'linux-x64': {
        file: 'gitleaks_8.28.0_linux_x64.tar.gz',
        sha256: 'a65b5253807a68ac0cafa4414031fd740aeb55f54fb7e55f386acb52e6a840eb',
      },
      'linux-arm64': {
        file: 'gitleaks_8.28.0_linux_arm64.tar.gz',
        sha256: 'eff65261156100e5d94a6b3dec313d532fddfe19ae1590bf7a2b4f2699128356',
      },
    },
  },
  actionlint: {
    version: '1.7.12',
    bin: 'actionlint',
    versionArgs: ['-version'],
    url: 'https://github.com/rhysd/actionlint/releases/download/v1.7.12/',
    archive: true,
    hint: 'https://github.com/rhysd/actionlint/releases/tag/v1.7.12',
    assets: {
      'darwin-arm64': {
        file: 'actionlint_1.7.12_darwin_arm64.tar.gz',
        sha256: 'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f',
      },
      'darwin-x64': {
        file: 'actionlint_1.7.12_darwin_amd64.tar.gz',
        sha256: '5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644',
      },
      'linux-x64': {
        file: 'actionlint_1.7.12_linux_amd64.tar.gz',
        sha256: '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8',
      },
      'linux-arm64': {
        file: 'actionlint_1.7.12_linux_arm64.tar.gz',
        sha256: '325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6',
      },
    },
  },
  zizmor: {
    version: '1.32.0',
    bin: 'zizmor',
    versionArgs: ['--version'],
    url: 'https://github.com/zizmorcore/zizmor/releases/download/v1.32.0/',
    archive: true,
    hint: 'https://github.com/zizmorcore/zizmor/releases/tag/v1.32.0',
    assets: {
      'darwin-arm64': {
        file: 'zizmor-aarch64-apple-darwin.tar.gz',
        sha256: '6efed18c4539a663fd3c851a2be9533fd8456c4e646d9416206da059154a0d3c',
      },
      'darwin-x64': {
        file: 'zizmor-x86_64-apple-darwin.tar.gz',
        sha256: '6983143c719ada6845a69cc4dd2bacc215f971662fecd8bbd2678388e5ce5969',
      },
      'linux-x64': {
        file: 'zizmor-x86_64-unknown-linux-gnu.tar.gz',
        sha256: 'bb110cc765eca9cd7efb2e284a956be5974c60027b0970f16397d86208a9957b',
      },
      'linux-arm64': {
        file: 'zizmor-aarch64-unknown-linux-gnu.tar.gz',
        sha256: 'cb152b207f815116d7fa1c1ee4614f61578803351395052908095e79adfd9fd0',
      },
    },
  },
  pinact: {
    version: '5.0.2',
    bin: 'pinact',
    versionArgs: ['version'],
    url: 'https://github.com/suzuki-shunsuke/pinact/releases/download/v5.0.2/',
    archive: true,
    hint: 'https://github.com/suzuki-shunsuke/pinact/releases/tag/v5.0.2',
    assets: {
      'darwin-arm64': {
        file: 'pinact_darwin_arm64.tar.gz',
        sha256: '9b9545d53376654005daaee5ab736d579887205ca3df99925c8fe8358c6e7fdb',
      },
      'darwin-x64': {
        file: 'pinact_darwin_amd64.tar.gz',
        sha256: '8fb6a0ee87b59bc2778371527c58a46073d5e289919bbd1c2559eff7efeb74e3',
      },
      'linux-x64': {
        file: 'pinact_linux_amd64.tar.gz',
        sha256: '7f003d8f51e984c2264d2009d430e3e0e87ae404a0e2dc2a9a277b0f731bf5b7',
      },
      'linux-arm64': {
        file: 'pinact_linux_arm64.tar.gz',
        sha256: '326e27f5b3b5fca21e6a169b2785ba2023df3dd9ee82dd0f4e438cb1220b68d7',
      },
    },
  },
};

const DOWNLOAD_TIMEOUT_MS = 180_000;
const VERSION_TIMEOUT_MS = 30_000;

/** A download whose sha256 does not match the pin. */
class ChecksumError extends Error {}

/**
 * Writes one line with the `install-tools:` prefix.
 *
 * @param {NodeJS.WriteStream} stream - Where to write.
 * @param {string} message - Text after the prefix.
 * @returns {void}
 */
function writeLine(stream, message) {
  stream.write(`install-tools: ${message}\n`);
}

const log = (/** @type {string} */ message) => writeLine(process.stdout, message);
const warn = (/** @type {string} */ message) => writeLine(process.stderr, `WARN ${message}`);
const fail = (/** @type {string} */ message) => writeLine(process.stderr, `ERROR ${message}`);

/**
 * Returns the version a binary reports, or null if it cannot run.
 *
 * @param {string} file - Path of the binary.
 * @param {{ version: string, versionArgs: string[] }} tool - The pin.
 * @returns {string | null} The pinned version when the output has it, else the first output line.
 */
function readVersion(file, tool) {
  try {
    const output = execFileSync(file, tool.versionArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: VERSION_TIMEOUT_MS,
    }).trim();
    return output.split(/\s+/).includes(tool.version)
      ? tool.version
      : (output.split('\n')[0] ?? '');
  } catch {
    return null;
  }
}

/**
 * Downloads an asset and checks its sha256 before anything is written.
 *
 * @param {{ url: string }} tool - The pin.
 * @param {{ file: string, sha256: string }} asset - The pinned file.
 * @returns {Promise<Buffer>} The bytes.
 */
async function downloadVerified(tool, asset) {
  const url = tool.url + asset.file;
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)} for ${url}`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  const actual = createHash('sha256').update(data).digest('hex');
  if (actual !== asset.sha256) {
    throw new ChecksumError(
      `sha256 mismatch for ${asset.file}: expected ${asset.sha256}, got ${actual}`,
    );
  }
  return data;
}

/**
 * Writes the verified bytes into a temporary folder and extracts them when the asset is an archive.
 *
 * @param {{ bin: string, archive: boolean }} tool - The pin.
 * @param {{ file: string }} asset - The pinned file.
 * @param {{ data: Buffer, temporaryDirectory: string }} options - Verified bytes and the work folder.
 * @returns {string} Path of the executable binary.
 */
function unpack(tool, asset, options) {
  const downloaded = path.join(options.temporaryDirectory, asset.file);
  writeBytes(downloaded, options.data);
  let binary = downloaded;
  if (tool.archive) {
    execFileSync('tar', ['-xzf', downloaded, '-C', options.temporaryDirectory, tool.bin], {
      stdio: 'inherit',
    });
    binary = path.join(options.temporaryDirectory, tool.bin);
  }
  makeExecutable(binary);
  return binary;
}

/**
 * Downloads, checks sha256, extracts if needed, and installs.
 * Throws ChecksumError for a hash mismatch.
 *
 * @param {{ name: string, tool: typeof PINS.gitleaks, asset: { file: string, sha256: string }, installDirectory: string }} options - What to install.
 * @returns {Promise<void>}
 */
async function install(options) {
  const { name, tool, asset, installDirectory } = options;
  const temporaryDirectory = makeTemporaryDirectory(`install-${name}-`);
  try {
    const data = await downloadVerified(tool, asset);
    const binary = unpack(tool, asset, { data, temporaryDirectory });
    movePath(binary, path.join(installDirectory, tool.bin));
  } finally {
    removePath(temporaryDirectory);
  }
}

/**
 * Splits the PATH variable into its entries.
 *
 * @returns {string[]} The entries, in order.
 */
function pathEntries() {
  return (readEnv('PATH') ?? '').split(path.delimiter);
}

/**
 * Finds the first executable file named `bin` on PATH (like `which`).
 *
 * @param {string} bin - File name.
 * @returns {string | null} The path, or null.
 */
function resolveOnPath(bin) {
  for (const directory of pathEntries()) {
    if (directory === '') {
      continue;
    }
    const candidate = path.join(directory, bin);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Installs one tool when it is missing or has the wrong version, then checks the result.
 *
 * @param {{ name: string, tool: typeof PINS.gitleaks, installDirectory: string, platformKey: string }} options - The tool and where to put it.
 * @returns {Promise<boolean>} True on a hard failure (checksum mismatch or wrong version after install).
 */
async function processTool(options) {
  const { name, tool, installDirectory, platformKey } = options;
  const destination = path.join(installDirectory, tool.bin);
  const asset = /** @type {Record<string, { file: string, sha256: string }>} */ (tool.assets)[
    platformKey
  ];
  if (!asset) {
    warn(
      `${name}: no pinned build for ${platformKey}, skipping. Install ${tool.version} by hand: ${tool.hint}`,
    );
    return false;
  }
  if (exists(destination) && readVersion(destination, tool) === tool.version) {
    log(`${name} ${tool.version} ok (${destination})`);
    return false;
  }
  try {
    await install({ name, tool, asset, installDirectory });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof ChecksumError) {
      fail(`${name}: ${message}. Not installed.`);
      return true;
    }
    warn(`${name}: download failed (${message}). Install ${tool.version} by hand: ${tool.hint}`);
    return false;
  }
  const reported = readVersion(destination, tool);
  if (reported === tool.version) {
    log(`${name} ${reported} installed (${destination})`);
    return false;
  }
  fail(`${name}: installed binary reports "${String(reported)}", expected ${tool.version}`);
  return true;
}

/**
 * Warns when another binary earlier on PATH shadows a pinned tool with a different version.
 *
 * @param {string} installDirectory - Where the pinned tools live.
 * @returns {void}
 */
function warnOnShadow(installDirectory) {
  for (const tool of Object.values(PINS)) {
    const destination = path.join(installDirectory, tool.bin);
    const first = resolveOnPath(tool.bin);
    if (!first || !exists(destination) || realPath(first) === realPath(destination)) {
      continue;
    }
    const shadowVersion = readVersion(first, tool);
    if (shadowVersion !== tool.version) {
      warn(
        `${first} (version ${shadowVersion ?? 'unknown'}) shadows the pinned ${tool.bin} ${tool.version} in ${installDirectory}. Put ${installDirectory} first on PATH.`,
      );
    }
  }
}

/**
 * Warns when the install folder is not on PATH, then checks for shadowing binaries.
 *
 * @param {string} installDirectory - Where the pinned tools live.
 * @returns {void}
 */
function checkPath(installDirectory) {
  const onPath = pathEntries().map((entry) => path.resolve(entry || '.'));
  if (!onPath.includes(installDirectory)) {
    warn(
      `${installDirectory} is not on PATH. Add this to your shell profile:\n  export PATH="${installDirectory}:$PATH"`,
    );
  }
  warnOnShadow(installDirectory);
}

/**
 * Tells why the install must be skipped.
 *
 * @returns {string | null} The reason, or null when the install runs.
 */
function skipReason() {
  if (readEnv('CI')) {
    return 'CI is set';
  }
  if (readEnv('SKIP_TOOL_INSTALL') === '1') {
    return 'SKIP_TOOL_INSTALL=1';
  }
  return null;
}

/**
 * Installs every pinned tool.
 *
 * @returns {Promise<number>} Exit code: 0 pass, 1 checksum or version failure.
 */
async function main() {
  const reason = skipReason();
  if (reason !== null) {
    log(`skipped, ${reason}`);
    return 0;
  }
  const installDirectory = path.resolve(
    readEnv('INSTALL_TOOLS_DIR') || path.join(os.homedir(), '.local', 'bin'),
  );
  makeDirectory(installDirectory);
  const platformKey = `${process.platform}-${process.arch}`;
  let hardFailure = false;
  for (const [name, tool] of Object.entries(PINS)) {
    const failed = await processTool({ name, tool, installDirectory, platformKey });
    hardFailure ||= failed;
  }
  checkPath(installDirectory);
  return hardFailure ? 1 : 0;
}

process.exitCode = await main();

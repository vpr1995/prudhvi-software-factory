// Runs after `rush install` (eventHooks.postRushInstall).
// Installs the non-npm binaries the git hooks need: gitleaks and opengrep.
// Each download is pinned and checked with sha256 before it is used.
// Env: CI or SKIP_TOOL_INSTALL=1 skips. INSTALL_TOOLS_DIR sets the install dir.
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
} from '../gates/lib/fs-io.mjs';
import { readEnv } from '../gates/lib/gates.config.mjs';

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
  opengrep: {
    version: '1.30.2',
    bin: 'opengrep',
    versionArgs: ['--version'],
    url: 'https://github.com/opengrep/opengrep/releases/download/v1.30.2/',
    archive: false, // raw executable
    hint: 'https://github.com/opengrep/opengrep/releases/tag/v1.30.2',
    assets: {
      'darwin-arm64': {
        file: 'opengrep_osx_arm64',
        sha256: 'f1aaa30b88959cb82522c4e1475816278a1f161f994509a518453c0455f9d24b',
      },
      'darwin-x64': {
        file: 'opengrep_osx_x86',
        sha256: 'fcf47da30d5c3a11119f2ec4e0d1ee55e3c3822e8f90d909bf9f33dfce99044a',
      },
      'linux-x64': {
        file: 'opengrep_manylinux_x86',
        sha256: 'a66aa3278457f02b287b985a45b6762aebcaba5000f2689245fd1ed86d1456c7',
      },
      'linux-arm64': {
        file: 'opengrep_manylinux_aarch64',
        sha256: '90acea5df4b733083f388d4feeb250ca802f671b33d1f222653d1e571dd2b0d8',
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

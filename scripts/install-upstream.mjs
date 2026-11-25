#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readlink, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const state = resolve(process.env.AGENT_STACK_HOME || join(homedir(), '.config', 'agent-stack'));
const bin = resolve(process.env.AGENT_STACK_BIN_DIR || join(homedir(), '.local', 'bin'));
const platform = `${process.platform}-${process.arch}`;
const mode = process.argv[2] ?? '--check';
const target = process.argv[3] ?? 'all';
const known = ['orca', 'codebase-memory', 'superpowers'];
const install = mode === '--install';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${(result.stderr || result.stdout || '').trim()}`);
  return (result.stdout || '').trim();
}
async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function requireHttps(url) {
  if (new URL(url).protocol !== 'https:') throw new Error('Upstream sources must use HTTPS.');
}
async function findFile(directory, basename) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isFile() && entry.name === basename) return path;
    if (entry.isDirectory()) { const found = await findFile(path, basename); if (found) return found; }
  }
  return undefined;
}
async function installOrca(tool) {
  if (process.platform !== 'darwin') {
    console.log('Orca: native installer required on this OS; see https://github.com/stablyai/orca/releases (no automatic install).');
    return;
  }
  if (await exists('/Applications/Orca.app') || await exists(join(homedir(), 'Applications', 'Orca.app'))) {
    console.log('Orca: app already installed; preserved.');
    return;
  }
  console.log(`Orca: ${install ? 'installing missing app via' : 'missing; installer:'} ${tool.macos.cask} (rolling Homebrew cask; reference ${tool.version}).`);
  if (install) {
    run('brew', ['tap', 'stablyai/orca'], { stdio: 'inherit' });
    run('brew', ['install', '--cask', tool.macos.cask], { stdio: 'inherit' });
  }
}
async function installMemory(tool) {
  const asset = tool.assets?.[platform];
  if (!asset) throw new Error(`Codebase Memory has no locked asset for ${platform}.`);
  const executable = process.platform === 'win32' ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp';
  const directory = join(state, 'tools', `codebase-memory-${tool.version}`, platform);
  const destination = join(directory, executable);
  const publicPath = join(bin, executable);
  const receipt = join(directory, 'receipt.json');
  let ready = false;
  if (await exists(destination) && await exists(receipt)) {
    const saved = JSON.parse(await readFile(receipt, 'utf8'));
    const digest = createHash('sha256').update(await readFile(destination)).digest('hex');
    ready = saved.archiveSha256 === asset.sha256 && saved.binarySha256 === digest;
    if (!ready) throw new Error(`Existing managed Codebase Memory failed integrity check: ${destination}`);
  }
  console.log(`Codebase Memory ${tool.version}: ${ready ? 'verified installation' : install ? 'installing locked asset' : 'missing'} (${platform}).`);
  if (!install) return;
  if (!ready) {
    requireHttps(asset.url);
    if (!/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Codebase Memory SHA256 missing or invalid.');
    const temporary = await mkdtemp(join(tmpdir(), 'agent-stack-'));
    try {
      const response = await fetch(asset.url);
      if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      const digest = createHash('sha256').update(buffer).digest('hex');
      if (digest !== asset.sha256) throw new Error('Codebase Memory archive SHA256 mismatch; installation cancelled.');
      const archive = join(temporary, asset.format === 'zip' ? 'archive.zip' : 'archive.tar.gz');
      const extraction = join(temporary, 'extracted');
      await writeFile(archive, buffer);
      await mkdir(extraction);
      // The archive is authenticated by its pinned hash. Reject absolute and traversal entries as well.
      if (asset.format === 'tar.gz') {
        const entries = run('tar', ['-tzf', archive]).split(/\r?\n/);
        if (entries.some((entry) => isAbsolute(entry) || entry.split(/[\\/]/).includes('..'))) throw new Error('Unsafe archive paths.');
        run('tar', ['-xzf', archive, '-C', extraction]);
      } else if (asset.format === 'zip' && process.platform === 'win32') {
        run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:AGENT_STACK_ARCHIVE -DestinationPath $env:AGENT_STACK_EXTRACT'], {
          env: { ...process.env, AGENT_STACK_ARCHIVE: archive, AGENT_STACK_EXTRACT: extraction },
        });
      } else throw new Error(`Unsupported archive format ${asset.format} on ${process.platform}.`);
      const extracted = await findFile(extraction, asset.binaryPath);
      if (!extracted) throw new Error(`Archive does not contain ${asset.binaryPath}.`);
      await mkdir(directory, { recursive: true });
      const staging = `${destination}.tmp-${process.pid}`;
      await copyFile(extracted, staging);
      await chmod(staging, 0o755);
      await rename(staging, destination);
      await writeFile(receipt, `${JSON.stringify({ version: tool.version, archiveSha256: digest, binarySha256: createHash('sha256').update(await readFile(destination)).digest('hex') }, null, 2)}\n`);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  await mkdir(bin, { recursive: true });
  if (await exists(publicPath)) {
    const existing = await lstat(publicPath);
    if (!existing.isSymbolicLink() || resolve(dirname(publicPath), await readlink(publicPath)) !== destination) {
      console.log(`Existing executable preserved: ${publicPath}. Managed binary is ${destination}.`);
      return;
    }
  } else if (process.platform === 'win32') {
    await copyFile(destination, publicPath);
  } else {
    await symlink(destination, publicPath);
  }
  console.log(`Codebase Memory ready: ${destination}`);
}
async function installSuperpowers(tool) {
  requireHttps(tool.repository);
  if (!/^[a-f0-9]{40}$/.test(tool.revision)) throw new Error('Superpowers requires a pinned Git commit.');
  const destination = join(state, 'vendor', 'superpowers');
  if (await exists(destination)) {
    const revision = run('git', ['-C', destination, 'rev-parse', 'HEAD']);
    if (revision !== tool.revision) throw new Error(`Existing Superpowers at ${destination} uses ${revision}; preserved. Expected ${tool.revision}.`);
    if (run('git', ['-C', destination, 'status', '--porcelain'])) throw new Error(`Superpowers has local changes at ${destination}; preserved.`);
    console.log(`Superpowers: verified ${tool.revision}.`);
    return;
  }
  console.log(`Superpowers: ${install ? 'installing' : 'missing'} pinned commit ${tool.revision}.`);
  if (!install) return;
  await mkdir(dirname(destination), { recursive: true });
  const staging = `${destination}.tmp-${process.pid}`;
  try {
    run('git', ['clone', '--no-checkout', '--filter=blob:none', tool.repository, staging], { stdio: 'inherit' });
    run('git', ['-C', staging, 'checkout', '--detach', tool.revision], { stdio: 'inherit' });
    if (run('git', ['-C', staging, 'rev-parse', 'HEAD']) !== tool.revision) throw new Error('Superpowers revision mismatch.');
    await rename(staging, destination);
  } finally { await rm(staging, { recursive: true, force: true }); }
  console.log(`Superpowers checkout ready: ${destination}. Agent discovery/configuration is handled separately.`);
}

try {
  if (!['--check', '--install'].includes(mode) || ![...known, 'all'].includes(target)) throw new Error('Usage: node scripts/install-upstream.mjs --check|--install [orca|codebase-memory|superpowers|all]');
  const lock = JSON.parse(await readFile(join(root, 'dependencies.lock.json'), 'utf8'));
  if (lock.schemaVersion !== 1) throw new Error('Unsupported dependency lock schema.');
  for (const name of target === 'all' ? known : [target]) {
    if (name === 'orca') await installOrca(lock.tools.orca);
    if (name === 'codebase-memory') await installMemory(lock.tools.codebaseMemory);
    if (name === 'superpowers') await installSuperpowers(lock.tools.superpowers);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

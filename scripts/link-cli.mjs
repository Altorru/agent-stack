#!/usr/bin/env node
import { readFile, writeFile, mkdir, rm, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const marker = 'agent-stack managed launcher';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const action = process.argv[2] ?? 'install';
const windows = process.platform === 'win32';
const destination = join(process.env.AGENT_STACK_BIN_DIR || join(homedir(), '.local', 'bin'), windows ? 'agentctl.cmd' : 'agentctl');
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

try {
  if (!['install', 'uninstall'].includes(action)) throw new Error('Usage: node scripts/link-cli.mjs install|uninstall');
  let existing;
  try {
    const info = await lstat(destination);
    if (info.isSymbolicLink()) throw new Error(`Refusing to replace symlink: ${destination}`);
    existing = await readFile(destination, 'utf8');
    if (!existing.includes(marker)) throw new Error(`Refusing to replace unrelated executable: ${destination}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (action === 'uninstall') {
    if (existing) await rm(destination);
    console.log(`Managed launcher removed: ${destination}. Repository, provider settings, and state were preserved.`);
  } else {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    const relative = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.agentctl;
    if (!relative) throw new Error('package.json does not declare the agentctl binary.');
    const binary = resolve(root, relative);
    await lstat(binary);
    const launcher = windows
      ? `@echo off\r\nrem ${marker}\r\n"${process.execPath.replaceAll('%', '%%')}" "${binary.replaceAll('%', '%%')}" %*\r\n`
      : `#!/bin/sh\n# ${marker}\nexec ${quote(process.execPath)} ${quote(binary)} "$@"\n`;
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, launcher, { mode: 0o755 });
    console.log(`Installed launcher: ${destination}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

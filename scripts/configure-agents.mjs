#!/usr/bin/env node
// Native integration changes stay outside Git. Existing files are preserved.
import { existsSync, mkdirSync, copyFileSync, chmodSync, readdirSync, lstatSync, readlinkSync, symlinkSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.platform === 'win32') {
  console.error('Run native integration setup inside WSL2. Windows profile management is supported separately.');
  process.exit(1);
}
const home = homedir();
const state = process.env.AGENT_STACK_HOME || path.join(home, '.config', 'agent-stack');
const backupDir = path.join(state, 'backups', 'native');
const memory = path.join(home, '.local', 'bin', 'codebase-memory-mcp');
const skills = path.join(state, 'vendor', 'superpowers', 'skills');
if (!existsSync(memory) || !existsSync(skills)) {
  console.error('Install locked tools first: node scripts/install-upstream.mjs --install all');
  process.exit(1);
}
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.error || result.status !== 0) throw new Error(`${command} failed; inspect its native message above.`);
}
mkdirSync(backupDir, { recursive: true, mode: 0o700 });
for (const [agent, file] of [['codex', '.codex/config.toml'], ['vibe', '.vibe/config.toml']]) {
  const source = path.join(home, file);
  if (existsSync(source)) {
    const backup = path.join(backupDir, `${agent}-${Date.now()}.toml`);
    copyFileSync(source, backup);
    chmodSync(backup, 0o600);
  }
}
const current = spawnSync('codex', ['mcp', 'get', 'codebase-memory', '--json'], { encoding: 'utf8', shell: false });
if (current.status === 0) {
  const entry = JSON.parse(current.stdout);
  if (entry.transport?.command !== memory) throw new Error('Existing Codex codebase-memory entry preserved: inspect it manually before changing its command.');
} else run('codex', ['mcp', 'add', 'codebase-memory', '--', memory]);
const vibeFile = path.join(home, '.vibe', 'config.toml');
const vibeText = existsSync(vibeFile) ? readFileSync(vibeFile, 'utf8') : '';
const vibeBlocks = vibeText.split(/(?=^\[\[mcp_servers\]\])/m);
const existingVibe = vibeBlocks.find(block => /^name\s*=\s*["']codebase-memory["']/m.test(block));
if (existingVibe) {
  const command = /^command\s*=\s*["']([^"']+)["']/m.exec(existingVibe)?.[1];
  if (command !== memory) throw new Error('Existing Vibe codebase-memory entry preserved: inspect it manually before changing its command.');
} else run('vibe', ['mcp', 'add', 'codebase-memory', '--transport', 'stdio', '--command', memory]);
run('orca', ['skills', 'install', '--skill', 'orca-cli', '--skill', 'orchestration', '--agent', 'codex,mistral-vibe,freebuff']);
for (const folder of [path.join(home, '.agents', 'skills'), path.join(home, '.vibe', 'skills')]) {
  mkdirSync(folder, { recursive: true });
  for (const name of readdirSync(skills)) {
    const source = path.join(skills, name);
    if (!existsSync(path.join(source, 'SKILL.md'))) continue;
    const target = path.join(folder, name);
    try {
      const current = lstatSync(target);
      if (current.isSymbolicLink() && path.resolve(path.dirname(target), readlinkSync(target)) === source) continue;
      console.warn(`Preserved existing skill: ${name} (${folder})`);
      continue;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    symlinkSync(source, target, 'dir');
  }
}
console.log('Native MCP and skills configured. Restart agent sessions to discover them.');

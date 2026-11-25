#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = await mkdtemp(join(tmpdir(), 'agent-stack-bootstrap-test-'));
const scripts = dirname(fileURLToPath(import.meta.url));
const environment = { ...process.env, AGENT_STACK_HOME: join(directory, 'state'), AGENT_STACK_BIN_DIR: join(directory, 'bin') };
function execute(script, args, expected = 0) {
  const result = spawnSync(process.execPath, [join(directory, 'scripts', script), ...args], { env: environment, encoding: 'utf8' });
  assert.equal(result.status, expected, `${script}: ${result.stdout}\n${result.stderr}`);
  return result;
}
try {
  await mkdir(join(directory, 'scripts'));
  for (const script of ['link-cli.mjs', 'install-upstream.mjs']) await copyFile(join(scripts, script), join(directory, 'scripts', script));
  await writeFile(join(directory, 'package.json'), JSON.stringify({ bin: { agentctl: 'bin.js' } }));
  await writeFile(join(directory, 'bin.js'), 'console.log("launcher ok");\n');
  const launcher = join(directory, 'bin', process.platform === 'win32' ? 'agentctl.cmd' : 'agentctl');
  execute('link-cli.mjs', ['install']);
  const first = await readFile(launcher, 'utf8');
  execute('link-cli.mjs', ['install']);
  assert.equal(await readFile(launcher, 'utf8'), first, 'Repeated installation must be idempotent.');
  execute('link-cli.mjs', ['uninstall']);
  await writeFile(launcher, 'unrelated executable\n');
  execute('link-cli.mjs', ['install'], 1);
  assert.equal(await readFile(launcher, 'utf8'), 'unrelated executable\n', 'Existing executable must be preserved.');
  execute('link-cli.mjs', ['uninstall'], 1);
  const platform = `${process.platform}-${process.arch}`;
  await writeFile(join(directory, 'dependencies.lock.json'), JSON.stringify({
    schemaVersion: 1,
    tools: { codebaseMemory: { version: 'test', assets: { [platform]: { url: 'https://example.invalid/archive.tar.gz', sha256: 'invalid', format: 'tar.gz', binaryPath: 'codebase-memory-mcp' } } } },
  }));
  const failed = execute('install-upstream.mjs', ['--install', 'codebase-memory'], 1);
  assert.match(failed.stderr, /SHA256 missing or invalid/);
  execute('install-upstream.mjs', ['--unknown'], 1);
  console.log('Bootstrap checks passed: idempotence, unrelated executable preservation, uninstall ownership, invalid digest refusal, invalid arguments.');
} finally {
  await rm(directory, { recursive: true, force: true });
}

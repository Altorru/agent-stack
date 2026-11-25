#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const marker = 'AGENT_STACK_ORCA_CODEX_OK';
const executable = process.env.ORCA_CLI_COMMAND || (process.env.ORCA_DEV_REPO_ROOT ? 'orca-dev' : process.platform === 'linux' && !process.env.ORCA_TERMINAL_HANDLE ? 'orca-ide' : 'orca');
const startedAt = Date.now();
const deadline = startedAt + 120_000;
const receipts = [];
let outputDirectory;
let dispatchId, runId;

function manual(message, reason) {
  const error = new Error(message);
  error.manualIntervention = true;
  error.reason = reason;
  return error;
}

function sanitized(value) {
  if (typeof value === 'string') return value.replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{15,})\b/g, '[REDACTED]');
  if (Array.isArray(value)) return value.map(sanitized);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /^(?:api_?key|access_?token|refresh_?token|authorization|password|secret)$/i.test(key) ? '[REDACTED]' : sanitized(item)]));
  return value;
}
function objects(value) {
  if (!value || typeof value !== 'object') return [];
  return [value, ...Object.values(value).flatMap(objects)];
}
function identifier(receipt, kind) {
  for (const record of objects(receipt)) {
    for (const key of [`${kind}Id`, `${kind}_id`]) if (typeof record[key] === 'string') return record[key];
    if (record[kind] && typeof record[kind].id === 'string') return record[kind].id;
  }
}
function dispatchRecord(receipt, id) {
  return objects(receipt).find((record) => record.id === id && ('status' in record || 'outcome' in record)) || objects(receipt).find((record) => (record.dispatchId === id || record.dispatch_id === id) && ('status' in record || 'outcome' in record));
}
function settledStatus(receipt, id) {
  const record = dispatchRecord(receipt, id);
  const values = [record?.status, record?.outcome, record?.attempt?.status, record?.dispatch?.status];
  const found = values.find((status) => ['succeeded', 'completed', 'failed'].includes(status));
  return found === 'completed' ? 'succeeded' : found;
}
function taskFor(receipt, id) {
  return objects(receipt).find((record) => record.dispatch_id === id && 'result' in record && 'status' in record);
}
function markerInFinalOutput(receipt, task) {
  // A task spec/user prompt also contains the marker. Only reported results or assistant transcript records count.
  if (typeof task?.result === 'string' && task.result.includes(marker)) return true;
  if (task?.result && typeof task.result === 'object' && JSON.stringify(task.result).includes(marker)) return true;
  return objects(receipt).some((record) => ['assistant', 'model'].includes(record.role) && JSON.stringify(record.content || record.text || record.message || '').includes(marker));
}
function verifiedNativeEvidence(receipt, task) {
  const messages = receipt?.result?.transcript?.messages || [];
  const calls = new Map();
  let packageVerified = false;
  let mcpVerified = false;
  let projectsCount;
  for (const message of messages) {
    for (const block of message.blocks || []) {
      if (message.role === 'assistant' && block.type === 'tool-call' && block.callId) calls.set(block.callId, block);
      if (message.role !== 'tool' || block.type !== 'tool-result' || !calls.has(block.callId)) continue;
      const call = calls.get(block.callId);
      const input = typeof call.input === 'string' ? call.input : JSON.stringify(call.input);
      const output = typeof block.output === 'string' ? block.output : JSON.stringify(block.output);
      if (/package\.json/.test(input) && /"name"\s*:\s*"@altorru\/agent-stack"/.test(output)) packageVerified = true;
      const actualMcpCall = /(?:tools\.)?mcp__codebase_memory__list_projects\s*\(/.test(input) || call.name === 'mcp__codebase_memory__list_projects';
      if (!actualMcpCall) continue;
      let result;
      try { result = JSON.parse(output.includes('\nOutput:\n') ? output.split('\nOutput:\n').slice(1).join('\nOutput:\n').trim() : output); } catch { continue; }
      let content = result.structuredContent;
      if (!content) {
        const text = result.content?.find((part) => part.type === 'text')?.text;
        try { content = JSON.parse(text); } catch { /* An unparseable tool reply supplies no proof. */ }
      }
      if (result.isError === false && Array.isArray(content?.projects) && Number.isInteger(content.total) && content.total >= 0) {
        mcpVerified = true;
        projectsCount = content.total;
      }
    }
  }
  let report;
  try { report = typeof task?.result === 'string' ? JSON.parse(task.result) : task?.result; } catch { /* Free text reports cannot replace correlated tool evidence. */ }
  const body = typeof report?.body === 'string' ? report.body : '';
  const workerReportVerified = report?.provenance === 'worker_report' && report?.outcome === 'succeeded' && body.includes('@altorru/agent-stack') && /list_projects/.test(body) && /succeed|success|réussi/i.test(body);
  return { verified: packageVerified && mcpVerified && workerReportVerified, packageVerified, mcpVerified, projectsCount, workerReportVerified };
}
async function savedLaunch(dispatch, run) {
  const base = join(root, '.local', 'orca-smoke');
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const filename of await readdir(join(base, entry.name))) {
      if (!/start\.json$/.test(filename)) continue;
      const saved = JSON.parse(await readFile(join(base, entry.name, filename), 'utf8'));
      if (saved.label === 'start' && saved.code === 0 && identifier(saved.json, 'dispatch') === dispatch && identifier(saved.json, 'run') === run) return saved;
    }
  }
  throw new Error('Resume refused: no successful local launch receipt matches this Dispatch and Run.');
}
async function command(label, arguments_, { timeout = Math.max(1, Math.min(30_000, deadline - Date.now())), allowFailure = false } = {}) {
  const result = await new Promise((resolveResult) => {
    let stdout = '', stderr = '';
    const child = spawn(executable, [...arguments_, '--environment', 'local', '--json'], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
    child.on('error', (error) => { clearTimeout(timer); resolveResult({ code: null, stdout, stderr: `${stderr}\n${error.message}` }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolveResult({ code, signal, stdout, stderr }); });
  });
  let json;
  try { json = JSON.parse(result.stdout); } catch { /* Preserve exact non-JSON output in the local receipt. */ }
  const receipt = sanitized({ label, args: arguments_, ...result, json });
  receipts.push(receipt);
  if (outputDirectory) await writeFile(join(outputDirectory, `${String(receipts.length).padStart(2, '0')}-${label}.json`), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  if (!allowFailure && (result.code !== 0 || json?.ok === false)) throw new Error(`${label} failed: ${JSON.stringify(sanitized(json || result.stderr || result.stdout))}`);
  return { ...result, json };
}

async function main() {
  if (!process.env.ORCA_TERMINAL_HANDLE) throw new Error('ORCA_TERMINAL_HANDLE is required. Launch this script in a newly created Orca terminal; never borrow or invent a sender handle.');
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    if (!['--resume-dispatch', '--resume-run'].includes(args[index]) || !args[index + 1]) throw new Error('Usage: node scripts/smoke-orca.mjs [--resume-dispatch ID --resume-run ID]');
  }
  const resumeDispatch = args.includes('--resume-dispatch') ? args[args.indexOf('--resume-dispatch') + 1] : undefined;
  const resumeRun = args.includes('--resume-run') ? args[args.indexOf('--resume-run') + 1] : undefined;
  if (Boolean(resumeDispatch) !== Boolean(resumeRun)) throw new Error('Resume requires both --resume-dispatch and --resume-run.');
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (pkg.name !== '@altorru/agent-stack') throw new Error(`Unexpected project package: ${pkg.name}`);
  outputDirectory = join(root, '.local', 'orca-smoke', new Date(startedAt).toISOString().replaceAll(':', '-'));
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await writeFile(join(root, '.local', 'orca-smoke', 'latest.json'), `${JSON.stringify({ outputDirectory, startedAt: new Date(startedAt).toISOString() }, null, 2)}\n`, { mode: 0o600 });
  const temporary = await mkdtemp(join(tmpdir(), 'agent-stack-orca-spec-'));
  try {
    if (resumeDispatch) {
      await savedLaunch(resumeDispatch, resumeRun);
      const owningRun = await command('resume-owner', ['orchestration', 'run-show', '--id', resumeRun, '--full']);
      if (owningRun.json?.result?.run?.coordinator_handle !== process.env.ORCA_TERMINAL_HANDLE) throw new Error('Resume refused: this terminal is not the Run coordinator. Rerun from the original coordinator shell; never override its handle.');
      dispatchId = resumeDispatch;
      runId = resumeRun;
      console.log(JSON.stringify({ event: 'worker_resumed', dispatchId, runId, outputDirectory }));
    } else {
    const specPath = join(temporary, 'spec.md');
    await writeFile(specPath, [
      'Read-only agent-stack installation smoke test. Do not edit, create, delete, commit, install, or run development commands in this repository. Do not delegate or create more workers.',
      `Target repository: ${root}. Read package.json and verify its name is @altorru/agent-stack.`,
      'Call the Codebase Memory MCP list_projects tool once and report whether it succeeded, with the number of projects returned. Do not index or modify the memory database.',
      `Only if both package verification and the actual MCP call succeed, put ${marker} on its own line in your final report, followed by the package name and MCP evidence. If either fails, report the exact error and a failed outcome; do not print the success marker.`,
      'Follow your Orca Task/Dispatch preamble to send worker_done to the coordinator, then end your turn. Treat successful completion of this read-only verification as succeeded; a failed MCP call or wrong package is failed.',
      'Placement: this machine (local), the user requested installation on this Mac.',
    ].join('\n'), { mode: 0o600 });
    const started = await command('start', ['orchestration', 'worker-start', '--spec-file', specPath, '--worktree', 'current', '--agent', 'codex', '--model', 'gpt-6-luna', '--effort', 'medium', '--task-title', 'Read-only agent-stack installation smoke', '--timeout-ms', '30000'], { timeout: 35_000 });
    dispatchId = identifier(started.json, 'dispatch');
    runId = identifier(started.json, 'run');
    if (!dispatchId) throw new Error('Start returned no verifiable Dispatch ID; no retry was attempted. Inspect the saved launch receipt.');
    console.log(JSON.stringify({ event: 'worker_started', dispatchId, runId, outputDirectory, next: started.json?.result?.next || started.json?.next }));
    if (started.json?.result?.blockedReason) throw manual(`Worker requires manual action: ${started.json.result.blockedReason}. Follow the saved receipt, then resume this same Dispatch from its original coordinator terminal.`, started.json.result.blockedReason);
    }
    const beforeWait = await command('precheck', ['orchestration', 'worker-show', '--dispatch', dispatchId, '--full']);
    if (beforeWait.json?.result?.observation?.agentWait) throw manual('Worker is waiting for a human response. Resolve the native prompt, then resume the same Dispatch.', 'agent_wait');
    const remaining = Math.max(1, deadline - Date.now() - 10_000);
    if (!settledStatus(beforeWait.json, dispatchId)) await command('wait', ['orchestration', 'check', '--peek', '--wait', '--types', 'worker_done', ...(runId ? ['--run', runId] : []), '--timeout-ms', String(remaining)], { timeout: remaining + 2000, allowFailure: true });
    const shown = await command('show', ['orchestration', 'worker-show', '--dispatch', dispatchId, '--full']);
    const read = await command('read', ['orchestration', 'worker-read', '--dispatch', dispatchId, '--source', 'auto', '--limit', '100'], { allowFailure: true });
    const tasks = await command('tasks', ['orchestration', 'task-list', '--run', runId, '--full'], { allowFailure: true });
    await command('list', ['orchestration', 'worker-list', ...(runId ? ['--run', runId] : []), '--limit', '10'], { allowFailure: true });
    const task = taskFor(tasks.json, dispatchId);
    const status = settledStatus(shown.json, dispatchId);
    let release;
    if (status) release = await command('release', ['orchestration', 'worker-release', '--dispatch', dispatchId], { allowFailure: true });
    const markerObserved = markerInFinalOutput(read.json, task);
    const nativeEvidence = verifiedNativeEvidence(read.json, task);
    const success = status === 'succeeded' && ['completed', 'succeeded'].includes(task?.status) && (markerObserved || nativeEvidence.verified);
    const summary = sanitized({ success, dispatchId, runId, status: status || 'unsettled_or_unverifiable', taskStatus: task?.status, markerObserved, nativeEvidence, release: release?.json, outputDirectory, elapsedMs: Date.now() - startedAt });
    await writeFile(join(outputDirectory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify(summary));
    if (!success && !status) throw manual(`Worker is unsettled or its final report is unavailable; inspect ${outputDirectory}. Resume the same Dispatch after resolving native environment prompts. No worker was retried or stopped.`, 'unsettled_or_unverifiable');
    if (!success) throw new Error(`Orca smoke test did not prove success (${summary.status}); inspect ${outputDirectory}. No worker was retried or stopped automatically.`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

main().catch(async (error) => {
  const failure = sanitized({ success: false, status: error.manualIntervention ? 'needs_manual_intervention' : 'failed', reason: error.reason, dispatchId, runId, error: error.message, outputDirectory, elapsedMs: Date.now() - startedAt });
  if (outputDirectory) await writeFile(join(outputDirectory, 'failure.json'), `${JSON.stringify(failure, null, 2)}\n`, { mode: 0o600 });
  console.error(JSON.stringify(failure));
  process.exitCode = error.manualIntervention ? 2 : 1;
});

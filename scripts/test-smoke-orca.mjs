#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Fixture-only protocol tests: these never connect to an Orca runtime or use real terminal handles.
const temporary = await mkdtemp(join(tmpdir(), 'agent-stack-smoke-test-'));
const source = join(dirname(fileURLToPath(import.meta.url)), 'smoke-orca.mjs');
const environment = { ...process.env };
delete environment.ORCA_TERMINAL_HANDLE;
delete environment.ORCA_CLI_COMMAND;
try {
  const missing = spawnSync(process.execPath, [source], { env: environment, encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /ORCA_TERMINAL_HANDLE is required/);
  if (process.platform !== 'win32') {
    await mkdir(join(temporary, 'scripts'));
    await copyFile(source, join(temporary, 'scripts', 'smoke-orca.mjs'));
    await writeFile(join(temporary, 'package.json'), JSON.stringify({ name: '@altorru/agent-stack' }));
    const fake = join(temporary, 'fixture-orca.mjs');
    const nativeTranscript = { transcript: { messages: [
      { role: 'user', blocks: [{ type: 'text', text: 'Only report AGENT_STACK_ORCA_CODEX_OK after actual verification.' }] },
      { role: 'assistant', blocks: [{ type: 'tool-call', name: 'exec', callId: 'package-call', input: 'await tools.exec_command({cmd:"cat package.json"})' }] },
      { role: 'tool', blocks: [{ type: 'tool-result', callId: 'package-call', output: 'Script completed\nOutput:\n{"name":"@altorru/agent-stack"}' }] },
      { role: 'assistant', blocks: [{ type: 'tool-call', name: 'exec', callId: 'mcp-call', input: 'const r=await tools.mcp__codebase_memory__list_projects({format:"json"});text(JSON.stringify(r));' }] },
      { role: 'tool', blocks: [{ type: 'tool-result', callId: 'mcp-call', output: `Script completed\nOutput:\n${JSON.stringify({ structuredContent: { projects: [{ name: 'fixture-project' }], total: 1 }, isError: false })}` }] },
    ] } };
    const nativeReport = JSON.stringify({ provenance: 'worker_report', outcome: 'succeeded', body: 'Package @altorru/agent-stack verified. Codebase Memory list_projects call succeeded and returned 1 project.' });
    await writeFile(fake, [
      '#!/usr/bin/env node',
      'import { appendFileSync } from "node:fs";',
      'const args = process.argv.slice(2); appendFileSync(process.env.FIXTURE_LOG, JSON.stringify(args) + "\\n");',
      'const verb = args[1]; let result;',
      'if (verb === "worker-start") { if (process.env.FIXTURE_MODE === "start-failure") { console.log(JSON.stringify({ok:false,error:{code:"agent_readiness"}})); process.exit(1); } result={dispatchId:"fixture_dispatch",runId:"fixture_run",...(process.env.FIXTURE_MODE === "trust-prompt" ? {blockedReason:"agent-trust-workspace"} : {})}; }',
      'else if (verb === "worker-show") result={dispatch:{id:"fixture_dispatch",task_id:"fixture_task",status:process.env.FIXTURE_MODE === "unsettled" ? "running" : "succeeded"}};',
      `else if (verb === "worker-read") { if (["native-evidence","mcp-error"].includes(process.env.FIXTURE_MODE)) { result=${JSON.stringify(nativeTranscript)}; if(process.env.FIXTURE_MODE === "mcp-error") result.transcript.messages[4].blocks[0].output=result.transcript.messages[4].blocks[0].output.replace('"isError":false','"isError":true'); } else result={messages:[{role:process.env.FIXTURE_MODE === "marker-in-prompt" ? "user" : "assistant",content:"AGENT_STACK_ORCA_CODEX_OK @altorru/agent-stack list_projects projects=1"}]}; }`,
      `else if (verb === "task-list") result={tasks:[{id:"fixture_task",dispatch_id:"fixture_dispatch",task_id:"fixture_task",status:process.env.FIXTURE_MODE === "unsettled" ? "dispatched" : "completed",result:process.env.FIXTURE_MODE === "marker-in-prompt" ? null : ["native-evidence","mcp-error"].includes(process.env.FIXTURE_MODE) ? ${JSON.stringify(nativeReport)} : "AGENT_STACK_ORCA_CODEX_OK package confirmed; list_projects projects=1"}]};`,
      'else if (verb === "run-show") result={run:{id:"fixture_run",coordinator_handle:"fixture_only_not_real"}};',
      'else if (verb === "worker-list") result={workers:[]};',
      'else if (verb === "worker-release") result={status:"released"};',
      'else if (verb === "check") result={messages:[{type:"worker_done",dispatchId:"fixture_dispatch"}]};',
      'else { console.error("Unexpected fixture command"); process.exit(2); }',
      'console.log(JSON.stringify({ok:true,result}));',
    ].join('\n'));
    await chmod(fake, 0o755);
    for (const mode of ['success', 'start-failure', 'unsettled', 'marker-in-prompt', 'trust-prompt', 'native-evidence', 'mcp-error']) {
      const log = join(temporary, `${mode}.jsonl`);
      const result = spawnSync(process.execPath, [join(temporary, 'scripts', 'smoke-orca.mjs')], {
        env: { ...environment, ORCA_TERMINAL_HANDLE: 'fixture_only_not_real', ORCA_CLI_COMMAND: fake, FIXTURE_LOG: log, FIXTURE_MODE: mode },
        encoding: 'utf8',
      });
      assert.equal(result.status, ['success', 'native-evidence'].includes(mode) ? 0 : ['unsettled', 'trust-prompt'].includes(mode) ? 2 : 1, `${mode}: ${result.stdout}\n${result.stderr}`);
      const calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
      assert.equal(calls.filter((args) => args[1] === 'worker-start').length, 1, 'Never retry a launch automatically.');
      assert(calls.every((args) => !args.includes('--from')), 'Never override sender identity.');
      assert.equal(calls.some((args) => args[1] === 'worker-release'), ['success', 'marker-in-prompt', 'native-evidence', 'mcp-error'].includes(mode), 'Only release a proven settled worker.');
      const wait = calls.find((args) => args[1] === 'check');
      if (wait) assert(wait.includes('--peek') && wait.includes('--wait'), 'Watcher must not consume coordinator mail.');
    }
    const resumeLog = join(temporary, 'resume.jsonl');
    const resumed = spawnSync(process.execPath, [join(temporary, 'scripts', 'smoke-orca.mjs'), '--resume-dispatch', 'fixture_dispatch', '--resume-run', 'fixture_run'], {
      env: { ...environment, ORCA_TERMINAL_HANDLE: 'fixture_only_not_real', ORCA_CLI_COMMAND: fake, FIXTURE_LOG: resumeLog, FIXTURE_MODE: 'success' }, encoding: 'utf8',
    });
    assert.equal(resumed.status, 0, `resume: ${resumed.stdout}\n${resumed.stderr}`);
    const resumeCalls = (await readFile(resumeLog, 'utf8')).trim().split('\n').map(JSON.parse);
    assert(!resumeCalls.some((args) => args[1] === 'worker-start'), 'Resume must never start another worker.');
    const wrongOwner = spawnSync(process.execPath, [join(temporary, 'scripts', 'smoke-orca.mjs'), '--resume-dispatch', 'fixture_dispatch', '--resume-run', 'fixture_run'], {
      env: { ...environment, ORCA_TERMINAL_HANDLE: 'fixture_wrong_owner', ORCA_CLI_COMMAND: fake, FIXTURE_LOG: resumeLog, FIXTURE_MODE: 'success' }, encoding: 'utf8',
    });
    assert.equal(wrongOwner.status, 1);
    assert.match(wrongOwner.stderr, /not the Run coordinator/);
  }
  console.log('Orca smoke protocol checks passed: required real context, one launch, no sender override, peek wait, settled-only release, failure reporting. Live orchestration is a separate test.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}

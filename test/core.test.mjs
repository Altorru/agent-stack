import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { state, saveState, activeProfile, providers, enabled, plan, verifyLaunch, launch, rollback, assertNativeExecutionSupported } from '../dist/core.js';

function fixture(t,agent='opencode',billing='subscription') {
 const root=mkdtempSync(path.join(os.tmpdir(),'agent-stack-test-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const home=path.join(root,'state'),project=path.join(root,'project with spaces'),bin=path.join(root,'bin');
 mkdirSync(path.join(root,'configs','profiles'),{recursive:true});mkdirSync(project);mkdirSync(bin);
 const model=agent==='opencode'?'opencode-go/deepseek-v4.1-flash':agent==='codex'?'gpt-6.1':agent==='vibe'?'devstral':'native';
 writeFileSync(path.join(root,'configs','providers.json'),JSON.stringify({providers:[{id:'test',agent,billing,enabledByDefault:true}]}));
 writeFileSync(path.join(root,'configs','profiles','test.json'),JSON.stringify({id:'test',description:'fixture',default:true,roles:{worker:{provider:'test',agent,model,effort:agent==='opencode'?'max':undefined}}}));
 const env={...process.env,PATH:bin+path.delimiter+process.env.PATH,FAKE_CAPTURE:path.join(root,'capture.json'),OPENAI_API_KEY:'should-not-leak',CODEX_API_KEY:'should-not-leak'};
 const script=`const fs=require('fs');const args=process.argv.slice(2);if(args[0]==='--version'){console.log('fake 1.0');process.exit(0);}if(args[0]==='debug'){let c=JSON.parse(process.env.OPENCODE_CONFIG_CONTENT||'{}');c.agent={build:{model:'expensive/other'},...c.agent};if(process.env.FAKE_AGENT_MISMATCH)c.agent['agent-stack-managed'].model='expensive/other';if(process.env.FAKE_AGENT_EFFORT)c.agent['agent-stack-managed'].options.reasoningEffort='low';if(process.env.FAKE_MISMATCH)c.model='other/model';if(process.env.FAKE_EFFORT)c.provider['opencode-go'].models['deepseek-v4.1-flash'].options.reasoningEffort='low';console.log(JSON.stringify(c));process.exit(0);}if(args[0]==='models'){if(process.env.FAKE_NO_MODEL){process.exit(1);}console.log('opencode-go/deepseek-v4.1-flash');process.exit(0);}if(args[0]==='login'){console.log(process.env.FAKE_API_LOGIN?'Logged in with API key':'Logged in using ChatGPT');process.exit(0);}fs.writeFileSync(process.env.FAKE_CAPTURE,JSON.stringify({args,hasKey:!!process.env.OPENAI_API_KEY,hasCodexKey:!!process.env.CODEX_API_KEY,config:JSON.parse(process.env.OPENCODE_CONFIG_CONTENT||'{}')}));process.exit(Number(process.env.FAKE_EXIT||0));`;
 const scriptPath=path.join(bin,agent+'.cjs');writeFileSync(scriptPath,script);
 return {root,home,project,bin,env,model,executables:{[agent]:{command:process.execPath,args:[scriptPath]}}};
}

test('default selection and rollback restore local provider state',t=>{
 const c=fixture(t);assert.equal(activeProfile(c).id,'test');
 saveState(c,{version:1,profile:'test',providers:{test:false}});
 assert.equal(enabled(c,providers(c)[0]),false);
 saveState(c,{...state(c),providers:{test:true}});assert.equal(enabled(c,providers(c)[0]),true);
 rollback(c);assert.equal(enabled(c,providers(c)[0]),false);
});
test('disabled provider blocks before any native execution',t=>{
 const c=fixture(t);saveState(c,{version:1,providers:{test:false}});
 assert.throws(()=>plan(c,{project:c.project,task:'implement'}),/disabled/);assert.equal(existsSync(c.env.FAKE_CAPTURE),false);
});
test('API use requires explicit per-launch paid opt-in',t=>{
 const c=fixture(t,'claude','api');assert.throws(()=>plan(c,{project:c.project,task:'implement'}),/allow-paid/);
 assert.equal(plan(c,{project:c.project,task:'implement',allowPaid:true}).command,'claude');
});
test('Freebuff requires both disclosure flags and produces interactive invocation',t=>{
 const c=fixture(t,'freebuff','free');
 for(const flags of [{},{allowFreebuff:true},{publicProject:true}])assert.throws(()=>plan(c,{project:c.project,task:'fix',...flags}),/both/);
 const l=plan(c,{project:c.project,task:'fix',allowFreebuff:true,publicProject:true});assert.equal(l.manualTask,true);assert.deepEqual(l.args,['--cwd',c.project]);
});
test('OpenCode isolation checks model and max effort before a launch',t=>{
 const c=fixture(t),l=plan(c,{project:c.project,task:'fix'});verifyLaunch(c,l);
 assert.deepEqual(JSON.parse(l.env.OPENCODE_CONFIG_CONTENT).enabled_providers,['opencode-go']);
 assert.equal(l.args.includes('--model'),false);assert.equal(l.args.includes('--effort'),false);
 assert.deepEqual(l.args.slice(3,5),['--agent','agent-stack-managed']);
 assert.throws(()=>verifyLaunch(c,{...l,env:{...l.env,FAKE_MISMATCH:'1'}}),/model mismatch/);
 assert.throws(()=>verifyLaunch(c,{...l,env:{...l.env,FAKE_EFFORT:'1'}}),/effort mismatch/);
 assert.throws(()=>verifyLaunch(c,{...l,env:{...l.env,FAKE_AGENT_MISMATCH:'1'}}),/managed agent model mismatch/);
 assert.throws(()=>verifyLaunch(c,{...l,env:{...l.env,FAKE_AGENT_EFFORT:'1'}}),/managed agent reasoning effort mismatch/);
 assert.throws(()=>verifyLaunch(c,{...l,env:{...l.env,FAKE_NO_MODEL:'1'}}),/unavailable/);
 assert.equal(existsSync(c.env.FAKE_CAPTURE),false);
});
test('launch preserves task as one argument and omits prompts and secrets from telemetry',async t=>{
 const c=fixture(t),task='literal $(touch /tmp/agent-stack-should-not-exist) `command` ; text';
 const l=plan(c,{project:c.project,task});assert.equal(await launch(c,l,task),0);
 const capture=JSON.parse(readFileSync(c.env.FAKE_CAPTURE,'utf8'));assert.equal(capture.args.at(-1),task);
 const telemetry=readFileSync(path.join(c.home,'usage.jsonl'),'utf8');assert.equal(telemetry.includes(task),false);assert.equal(telemetry.includes('should-not-leak'),false);
 assert.equal(telemetry.split('\n').filter(Boolean).length,2);
});
test('native nonzero exit reaches caller',async t=>{
 const c=fixture(t);c.env.FAKE_EXIT='7';assert.equal(await launch(c,plan(c,{project:c.project,task:'fail'}),'fail'),7);
});
test('Windows uses portable fake executable mapping and rejects unsupported native mutation',async t=>{
 const c=fixture(t);c.platform='win32';assert.equal(await launch(c,plan(c,{project:c.project,task:'windows fixture'}),'windows fixture'),0);
 const unsupported={...c,executables:undefined};assert.throws(()=>assertNativeExecutionSupported(unsupported),/require WSL2/);
 assert.throws(()=>verifyLaunch(unsupported,plan(unsupported,{project:c.project,task:'must not run'})),/require WSL2/);
});
test('Codex subscription launch removes API credentials and verifies ChatGPT auth',t=>{
 const c=fixture(t,'codex'),l=plan(c,{project:c.project,task:'fix'});verifyLaunch(c,l);
 assert.equal(l.env.OPENAI_API_KEY,undefined);assert.equal(l.env.CODEX_API_KEY,undefined);assert.ok(l.args.includes('model_provider="openai"'));
 assert.throws(()=>verifyLaunch(c,{...l,env:{...l.env,FAKE_API_LOGIN:'1'}}),/ChatGPT authentication/);
});
test('Vibe uses supported workdir/model/headless prompt arguments',t=>{
 const c=fixture(t,'vibe');const l=plan(c,{project:c.project,task:'hello world'});
 assert.deepEqual(l.args,['--workdir',c.project,'--model','devstral','--time-limit','600','--max-turns','30','--prompt','hello world']);
});
test('CLI dry run does not launch models and unknown options fail',t=>{
 const c=fixture(t);const cli=path.resolve('dist/cli.js');const env={...c.env,AGENT_STACK_HOME:c.home,AGENT_STACK_ROOT:c.root};
 const r=spawnSync(process.execPath,[cli,'run','--project',c.project,'--task','fix','--dry-run'],{env,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).dryRun,true);assert.equal(existsSync(c.env.FAKE_CAPTURE),false);
 const bad=spawnSync(process.execPath,[cli,'run','--nonsense'],{env,encoding:'utf8'});assert.equal(bad.status,1);assert.match(bad.stderr,/Unknown option/);
});

#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { context, providers, profiles, state, saveState, activeProfile, enabled, installed, runCommand, plan, launch, rollback, assertNativeExecutionSupported, executable, UserError, type Context } from './core.js';

const help=`agentctl — reproducible native coding agents

agentctl doctor [--json]
agentctl status [--json]
agentctl profile list
agentctl profile use NAME
agentctl provider list
agentctl provider enable|disable|login NAME
agentctl run --project PATH --task TEXT [--role worker|orchestrator|ui]
             [--dry-run] [--allow-paid] [--allow-freebuff --public-project]
agentctl usage [--period month|all] [--json]
agentctl update --check
agentctl update --apply
agentctl rollback --last

Profile changes affect agentctl launches only. run executes one native CLI;
Orca orchestration uses the separate Orca application and orchestration prompt.
API providers require per-launch --allow-paid. No automatic provider fallback.
Dry-run validates policy and prints a plan without invoking any model.
Telemetry records launches/exits only; token counts and charges are not inferred.
Update applies only a clean fast-forward of this repository, then rebuilds.
Rollback restores agentctl state only, not external tools or project files.
Windows native launches and update --apply require WSL2; dry-run stays native.
`;
function parse(args:string[]):{pos:string[];flags:Record<string,string|boolean>} {
  const pos:string[]=[],flags:Record<string,string|boolean>={};
  const values=new Set(['project','task','role','period']);
  const bools=new Set(['json','dry-run','allow-paid','allow-freebuff','public-project','check','apply','last']);
  for(let i=0;i<args.length;i++) {const arg=args[i]!; if(!arg.startsWith('--')){pos.push(arg);continue;}
    const name=arg.slice(2); if(values.has(name)){const value=args[++i];if(value===undefined||value.startsWith('--'))throw new UserError(`--${name} requires a value`);flags[name]=value;}
    else if(bools.has(name))flags[name]=true;else throw new UserError(`Unknown option: ${arg}`);
  }return {pos,flags};
}
function out(value:unknown):void{console.log(JSON.stringify(value,null,2));}
function exact(pos:string[],length:number):void{if(pos.length!==length)throw new UserError('Unexpected or missing arguments. Run agentctl --help.');}
async function doctor(ctx:Context,asJSON:boolean):Promise<number> {
  const p=activeProfile(ctx),catalog=providers(ctx),checks:Array<{name:string;ok:boolean;detail:string}>=[];
  const tools=new Set(Object.values(p.roles).map(r=>r.agent));
  for(const tool of tools){const result=installed(ctx,tool);checks.push({name:tool,ok:result.ok,detail:result.version});}
  for(const [name,role]of Object.entries(p.roles)){
    const provider=catalog.find(v=>v.id===role.provider);
    checks.push({name:`${name}:provider`,ok:!!provider&&enabled(ctx,provider),detail:provider ? (enabled(ctx,provider)?`${provider.id} enabled (${provider.billing}); native authentication retained`:`${provider.id} disabled`) : `${role.provider} missing`});
    if(role.agent==='opencode'&&installed(ctx,'opencode').ok){
      const prefix=role.model.split('/')[0]!,r=runCommand(ctx,'opencode',['models',prefix]);
      const available=r.status===0&&r.stdout.split(/\r?\n/).some(l=>l.trim()===role.model);
      checks.push({name:`${name}:model`,ok:available,detail:available?`${role.model} in native catalog`:`${role.model} unavailable; configure native authentication and verify the model ID`});
    }
    if(role.agent==='codex'&&provider?.billing==='subscription'&&installed(ctx,'codex').ok){const r=runCommand(ctx,'codex',['login','status']);checks.push({name:`${name}:auth`,ok:r.status===0&&/chatgpt/i.test(r.stdout+' '+r.stderr),detail:r.status===0&&/chatgpt/i.test(r.stdout+' '+r.stderr)?'ChatGPT login verified':'ChatGPT login unverified; run provider login'});}
  }
  const ok=checks.every(c=>c.ok)&&!p.disabled;
  const result={ok,profile:p.id,checks,notes:['No model completion or payment was requested.','Catalog availability does not prove subscription quota or billing balance.','Vibe and Freebuff credentials require native verification.']};
  if(asJSON)out(result);else{console.log(`Profile: ${p.id}`);for(const c of checks)console.log(`${c.ok?'OK':'BLOCKED'} ${c.name}: ${c.detail}`);console.log('No model completion or payment requested.');}
  return ok?0:1;
}
async function interactive(command:string,args:string[],ctx:Context):Promise<number>{assertNativeExecutionSupported(ctx);return await new Promise((resolve,reject)=>{const resolved=executable(ctx,command,args);const child=spawn(resolved.command,resolved.args,{cwd:ctx.root,stdio:'inherit',env:ctx.env,shell:false});child.once('error',e=>reject(new UserError(`Cannot run ${command}: ${e.message}`)));child.once('exit',code=>resolve(code??1));});}
async function main():Promise<number>{
  const args=process.argv.slice(2),ctx=context();
  if(!args.length||args.includes('--help')||args[0]==='help'||args[0]==='-h'){console.log(help);return 0;}
  if(args[0]==='--version'){console.log('agentctl '+JSON.parse(readFileSync(path.join(ctx.root,'package.json'),'utf8')).version);return 0;}
  const {pos,flags}=parse(args),command=pos[0];
  if(command==='doctor'){exact(pos,1);return await doctor(ctx,!!flags.json);}
  if(command==='status'){exact(pos,1);const p=activeProfile(ctx);out({profile:p.id,description:p.description,stateDirectory:ctx.home,providers:providers(ctx).map(v=>({id:v.id,agent:v.agent,billing:v.billing,enabled:enabled(ctx,v)})),roles:p.roles});return 0;}
  if(command==='profile'){
    if(pos[1]==='list'){exact(pos,2);const active=activeProfile(ctx).id;for(const p of profiles(ctx))console.log(`${p.id===active?'*':' '} ${p.id}${p.disabled?' [reference blocked]':''} — ${p.description}`);return 0;}
    if(pos[1]==='use'){exact(pos,3);const p=profiles(ctx).find(p=>p.id===pos[2]);if(!p)throw new UserError(`Unknown profile: ${pos[2]}`);saveState(ctx,{...state(ctx),profile:p.id});console.log(`Active profile: ${p.id}. Native global configurations were preserved.`);return 0;}
    throw new UserError('Use profile list or profile use NAME');
  }
  if(command==='provider'){
    const ps=providers(ctx);
    if(pos[1]==='list'){exact(pos,2);for(const p of ps)console.log(`${enabled(ctx,p)?'enabled ':'disabled'} ${p.id} (${p.agent}, ${p.billing})`);return 0;}
    exact(pos,3);const provider=ps.find(v=>v.id===pos[2]);if(!provider)throw new UserError(`Unknown provider: ${pos[2]}`);
    if(pos[1]==='enable'||pos[1]==='disable'){const s=state(ctx);s.providers[provider.id]=pos[1]==='enable';saveState(ctx,s);console.log(`${provider.id} ${pos[1]}d. This does not change or cancel subscriptions.`);return 0;}
    if(pos[1]==='login'){
      const fallback:Record<string,string[]>={opencode:['auth','login'],codex:['login'],vibe:['--setup'],freebuff:['login'],claude:['auth','login']};
      console.log(`Opening native ${provider.agent} authentication. Verify subscription access in that tool.`);
      return await interactive(provider.agent,provider.loginArgs||fallback[provider.agent]!,ctx);
    }throw new UserError('Use provider list, enable, disable or login');
  }
  if(command==='run'){
    exact(pos,1);if(typeof flags.project!=='string'||typeof flags.task!=='string')throw new UserError('run requires --project PATH and --task TEXT');
    const l=plan(ctx,{project:flags.project,task:flags.task,role:typeof flags.role==='string'?flags.role:undefined,allowPaid:!!flags['allow-paid'],allowFreebuff:!!flags['allow-freebuff'],publicProject:!!flags['public-project']});
    if(flags['dry-run']){out({dryRun:true,profile:l.profile,provider:l.role.provider,model:l.role.model,effort:l.role.effort||null,command:l.command,args:l.args,project:l.project,manualTask:l.manualTask,checks:'Policy validated; native authentication and effective model are verified when launching. No model called.'});return 0;}
    console.log(`Launching ${l.command}, provider ${l.role.provider}, model ${l.role.model}; no fallback.`);
    return await launch(ctx,l,flags.task);
  }
  if(command==='usage'){
    exact(pos,1);const period=flags.period||'month';if(period!=='month'&&period!=='all')throw new UserError('--period must be month or all');
    const f=path.join(ctx.home,'usage.jsonl'),prefix=new Date().toISOString().slice(0,7);
    const entries=existsSync(f)?readFileSync(f,'utf8').split('\n').filter(Boolean).map((line,i)=>{try{return JSON.parse(line);}catch{throw new UserError(`Invalid telemetry line ${i+1}`);}}).filter(e=>period==='all'||String(e.timestamp).startsWith(prefix)):[];
    out({period,launches:entries.filter(e=>e.event==='start').length,finished:entries.filter(e=>e.event==='finish').length,failed:entries.filter(e=>e.event==='finish'&&e.exitCode!==0).length,tokens:null,cost:null,note:'Launch telemetry only; use provider dashboards for tokens, costs, quotas and invoices.'});return 0;
  }
  if(command==='rollback'){exact(pos,1);if(!flags.last)throw new UserError('Use rollback --last');console.log(`Restored agentctl state from ${rollback(ctx)}. External tool versions were not changed.`);return 0;}
  if(command==='update'){
    exact(pos,1);if(Boolean(flags.check)===Boolean(flags.apply))throw new UserError('Choose update --check or update --apply');
    if(flags.apply)assertNativeExecutionSupported(ctx);
    const git=runCommand(ctx,'git',['rev-parse','--show-toplevel'],ctx.root);if(git.status!==0)throw new UserError('agent-stack source is not a Git checkout; update it from its original source.');
    if(flags.check){const r=runCommand(ctx,'git',['status','--short','--branch'],ctx.root);out({repository:r.stdout.trim(),tools:[...new Set(providers(ctx).map(p=>p.agent))].map(agent=>({agent,...installed(ctx,agent)})),note:'Installed versions and local Git tracking state only. Fetch upstream to refresh ahead/behind; no automatic upgrades.'});return 0;}
    const dirty=runCommand(ctx,'git',['status','--porcelain'],ctx.root);if(dirty.status!==0||dirty.stdout.trim())throw new UserError('Update refused: commit or stash local changes first.');
    const result=runCommand(ctx,'git',['pull','--ff-only'],ctx.root);if(result.status!==0)throw new UserError('Fast-forward update failed. Inspect Git manually; no reset performed.');
    console.log(result.stdout.trim());const install=await interactive('npm',['ci'],ctx);return install===0?await interactive('npm',['run','build'],ctx):install;
  }
  throw new UserError(`Unknown command: ${command}. Run agentctl --help.`);
}
main().then(code=>{process.exitCode=code;}).catch(error=>{console.error(`agentctl: ${error instanceof Error?error.message:String(error)}`);process.exitCode=1;});

import { spawnSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export type Agent = 'opencode' | 'codex' | 'vibe' | 'freebuff' | 'claude';
export interface Provider { id: string; agent: Agent; billing: 'subscription' | 'api' | 'free'; loginArgs?: string[]; enabledByDefault?: boolean; modelPrefix?: string; description?: string }
export interface Role { provider: string; agent: Agent; model: string; effort?: string; opencodeOptions?: Record<string, unknown> }
export interface Profile { id: string; description: string; default?: boolean; roles: Record<string, Role>; opencode?: Record<string, unknown>; disabled?: boolean; reason?: string }
export interface State { version: 1; profile?: string; providers: Record<string, boolean> }
export interface Context { root: string; home: string; env: NodeJS.ProcessEnv; platform?: NodeJS.Platform; executables?: Record<string,{command:string;args:string[]}> }
export class UserError extends Error {}
const agents = new Set<Agent>(['opencode', 'codex', 'vibe', 'freebuff', 'claude']);
export function context(): Context {
  return {root: process.env.AGENT_STACK_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), home: process.env.AGENT_STACK_HOME || path.join(homedir(), '.config', 'agent-stack'), env: {...process.env}};
}
export function json(file: string): any { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { throw new UserError(`Cannot read valid JSON: ${file}`); } }
export function providers(ctx: Context): Provider[] {
  const file = path.join(ctx.root, 'configs', 'providers.json');
  if (!existsSync(file)) throw new UserError(`Missing provider catalog: ${file}`);
  const value = json(file); const list: Provider[] = Array.isArray(value) ? value : Array.isArray(value.providers) ? value.providers : Object.entries(value).map(([id,v])=>({id,...v as object}));
  for (const p of list) if (!p.id || !agents.has(p.agent) || !['subscription','api','free'].includes(p.billing)) throw new UserError(`Invalid provider catalog entry: ${p.id || '(missing id)'}`);
  if (new Set(list.map(p=>p.id)).size !== list.length) throw new UserError('Duplicate provider IDs');
  return list;
}
export function profiles(ctx: Context): Profile[] {
  const folder = path.join(ctx.root,'configs','profiles');
  if (!existsSync(folder)) throw new UserError(`Missing profile folder: ${folder}`);
  return readdirSync(folder).filter(f=>f.endsWith('.json')).sort().map(f=>{
    const p: Profile=json(path.join(folder,f));
    if (!p.id || !p.roles || typeof p.roles !== 'object') throw new UserError(`Invalid profile: ${f}`);
    for (const [name,r] of Object.entries(p.roles)) if (!r.provider || !agents.has(r.agent) || typeof r.model !== 'string' || !r.model.trim()) throw new UserError(`Invalid role ${name} in ${f}`);
    return p;
  });
}
export function state(ctx: Context): State {
  const f=path.join(ctx.home,'state.json');
  if (!existsSync(f)) return {version:1,providers:{}};
  const s=json(f); if(s.version!==1 || !s.providers || typeof s.providers!=='object') throw new UserError(`Invalid state: ${f}`);
  return s;
}
function atomic(file: string, value: unknown): void {
  mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const temp=`${file}.${randomUUID()}.tmp`;
  writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600}); renameSync(temp,file);
}
export function saveState(ctx: Context, next: State): void {
  const file=path.join(ctx.home,'state.json');
  if(existsSync(file)) atomic(path.join(ctx.home,'backups',`${Date.now()}-${process.hrtime.bigint()}-${randomUUID()}.json`),state(ctx));
  atomic(file,next);
}
export function activeProfile(ctx: Context): Profile {
  const ps=profiles(ctx), id=state(ctx).profile;
  const p=id ? ps.find(p=>p.id===id) : ps.find(p=>p.default) || ps.find(p=>p.id==='reddit-go-only') || ps[0];
  if(!p) throw new UserError(id ? `Selected profile ${id} no longer exists. Run agentctl profile list.` : 'No profiles installed');
  return p;
}
export function enabled(ctx: Context,p: Provider): boolean { return state(ctx).providers[p.id] ?? p.enabledByDefault ?? false; }
export function assertNativeExecutionSupported(ctx:Context):void {
  if((ctx.platform||process.platform)==='win32'&&!ctx.executables)throw new UserError('Native agent launches and repository updates on Windows require WSL2. Run agentctl from its Linux checkout; configuration, status and dry-run remain available natively.');
}
export function executable(ctx:Context,command:string,args:string[]):{command:string;args:string[]} {
  const override=ctx.executables?.[command];
  return override?{command:override.command,args:[...override.args,...args]}:{command,args};
}
export function runCommand(ctx: Context, command: string, args: string[], cwd?: string, env?: NodeJS.ProcessEnv): {status:number;stdout:string;stderr:string} {
  const resolved=executable(ctx,command,args);
  const r=spawnSync(resolved.command,resolved.args,{cwd,env:env||ctx.env,encoding:'utf8',timeout:20000,maxBuffer:8*1024*1024,windowsHide:true});
  if(r.error) return {status:1,stdout:'',stderr:r.error.message};
  return {status:r.status ?? 1,stdout:r.stdout||'',stderr:r.stderr||''};
}
export function installed(ctx: Context, agent: string): {ok:boolean;version:string} {
  const r=runCommand(ctx,agent,['--version']);
  return {ok:r.status===0,version:r.status===0?r.stdout.trim().split('\n')[0]||'installed':'not installed or unavailable'};
}
function parseOutputJSON(output: string): any { try{return JSON.parse(output);}catch { const start=output.indexOf('{'), end=output.lastIndexOf('}'); if(start>=0 && end>start) try{return JSON.parse(output.slice(start,end+1));}catch{} throw new UserError('OpenCode returned invalid effective configuration JSON. No agent launched.'); } }
export interface Launch { command: Agent; args: string[]; env: NodeJS.ProcessEnv; project: string; role: Role; profile: string; manualTask: boolean; managedConfig?: Record<string,unknown> }
export interface RunOptions { project:string;task:string;role?:string;allowPaid?:boolean;allowFreebuff?:boolean;publicProject?:boolean }
export function plan(ctx: Context, options: RunOptions): Launch {
  if (!options.task?.trim()) throw new UserError('A non-empty --task is required');
  const project=path.resolve(options.project);
  if(!existsSync(project)||!statSync(project).isDirectory()) throw new UserError(`Project directory not found: ${project}`);
  const p=activeProfile(ctx);
  if(p.disabled) throw new UserError(`Profile ${p.id} is a disabled reference: ${p.reason||'requires unavailable upstream configuration'}`);
  const roleName=options.role||'worker',role=p.roles[roleName];
  if(!role) throw new UserError(`Profile ${p.id} has no ${roleName} role`);
  const provider=providers(ctx).find(v=>v.id===role.provider);
  if(!provider || provider.agent!==role.agent) throw new UserError(`Profile role ${roleName} does not match provider catalog`);
  if(!enabled(ctx,provider)) throw new UserError(`Provider ${provider.id} is disabled. Enable it explicitly with agentctl provider enable ${provider.id}.`);
  if(provider.billing==='api'&&!options.allowPaid) throw new UserError(`Provider ${provider.id} uses a paid API. Add --allow-paid for this launch.`);
  if(role.agent==='freebuff'&&(!options.allowFreebuff||!options.publicProject)) throw new UserError('Freebuff requires both --allow-freebuff and --public-project; confidential projects are blocked by default.');
  if(provider.modelPrefix&&!role.model.startsWith(provider.modelPrefix)) throw new UserError(`Model ${role.model} does not belong to ${provider.id}`);
  const env={...ctx.env}; let args:string[]=[],managedConfig:Record<string,unknown>|undefined;
  if(role.agent==='opencode') {
    const providerId=role.model.split('/')[0],modelId=role.model.slice((providerId?.length||0)+1);
    if(!providerId || !role.model.includes('/')) throw new UserError('OpenCode model must have provider/model form');
    managedConfig={...p.opencode,...role.opencodeOptions,model:role.model,enabled_providers:[providerId]};
    if(role.effort){
      const conf=(managedConfig.provider||{}) as Record<string,any>;
      const target=conf[providerId]||{}, models=target.models||{}, model=models[modelId]||{};
      managedConfig.provider={...conf,[providerId]:{...target,models:{...models,[modelId]:{...model,options:{...model.options,reasoningEffort:role.effort}}}}};
    }
    const configuredAgents=(managedConfig.agent||{}) as Record<string,unknown>;
    managedConfig.agent={...configuredAgents,'agent-stack-managed':{mode:'primary',model:role.model,...(role.effort?{options:{reasoningEffort:role.effort},variant:role.effort}:{})}};
    managedConfig.default_agent='agent-stack-managed';
    env.OPENCODE_CONFIG_CONTENT=JSON.stringify(managedConfig);
    args=['run','--dir',project,'--agent','agent-stack-managed','--',options.task];
  } else if(role.agent==='codex') {
    if(provider.billing==='subscription') { delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY; }
    args=['exec','--cd',project,'--model',role.model,'--sandbox','workspace-write'];
    if(provider.billing==='subscription')args.push('-c','model_provider="openai"');
    if(role.effort)args.push('-c',`model_reasoning_effort=${JSON.stringify(role.effort)}`);
    args.push('--',options.task);
  } else if(role.agent==='vibe') {
    args=['--workdir',project,'--model',role.model]; if(role.effort)args.push('--thinking',role.effort);
    args.push('--time-limit','600','--max-turns','30','--prompt',options.task);
  } else if(role.agent==='claude') {
    args=['--print','--model',role.model]; if(role.effort)args.push('--effort',role.effort); args.push('--',options.task);
  } else args=['--cwd',project];
  return {command:role.agent,args,env,project,role,profile:p.id,manualTask:role.agent==='freebuff',managedConfig};
}
export function verifyLaunch(ctx:Context,launch:Launch): void {
  assertNativeExecutionSupported(ctx);
  if(!installed(ctx,launch.command).ok) throw new UserError(`${launch.command} is not installed. Run scripts/bootstrap.sh.`);
  if(launch.command==='opencode') {
    const debug=runCommand(ctx,'opencode',['debug','config'],launch.project,launch.env);
    if(debug.status!==0) throw new UserError('OpenCode effective configuration could not be resolved. Run opencode debug config locally; no agent launched.');
    const effective=parseOutputJSON(debug.stdout);
    if(effective.model!==launch.role.model) throw new UserError(`OpenCode model mismatch: expected ${launch.role.model}, found ${effective.model||'(unset)'}. No fallback performed.`);
    const agent=effective.agent?.['agent-stack-managed'];
    if(agent?.model!==launch.role.model||agent?.mode!=='primary')throw new UserError('OpenCode managed agent model mismatch. No agent launched.');
    if(launch.role.effort&&(agent.options?.reasoningEffort!==launch.role.effort||agent.variant!==launch.role.effort))throw new UserError('OpenCode managed agent reasoning effort mismatch. No agent launched.');
    if(!Array.isArray(effective.enabled_providers)||effective.enabled_providers.length!==1||effective.enabled_providers[0]!==launch.role.model.split('/')[0])throw new UserError('OpenCode provider isolation mismatch. No agent launched.');
    if(launch.role.effort){const [prefix,...parts]=launch.role.model.split('/');const actual=effective.provider?.[prefix!]?.models?.[parts.join('/')]?.options?.reasoningEffort;if(actual!==launch.role.effort)throw new UserError(`OpenCode reasoning effort mismatch: expected ${launch.role.effort}, found ${actual||'(unset)'}. No agent launched.`);}
    const models=runCommand(ctx,'opencode',['models',launch.role.model.split('/')[0]!],launch.project,launch.env);
    if(models.status!==0 || !models.stdout.split(/\r?\n/).some(line=>line.trim()===launch.role.model)) throw new UserError(`OpenCode model ${launch.role.model} is unavailable. Authenticate with agentctl provider login ${launch.role.provider}, then verify the subscribed model catalog. No fallback performed.`);
  }
  if(launch.command==='codex'&&providers(ctx).find(p=>p.id===launch.role.provider)?.billing==='subscription') {
    const auth=runCommand(ctx,'codex',['login','status'],launch.project,launch.env);
    if(auth.status!==0 || !/chatgpt/i.test(auth.stdout+' '+auth.stderr)) throw new UserError('Codex ChatGPT authentication is not verified. Run agentctl provider login '+launch.role.provider+'. No API fallback performed.');
  }
}
export function record(ctx:Context,entry:Record<string,unknown>): void {
  mkdirSync(ctx.home,{recursive:true,mode:0o700});
  writeFileSync(path.join(ctx.home,'usage.jsonl'),JSON.stringify({timestamp:new Date().toISOString(),...entry})+'\n',{flag:'a',mode:0o600});
}
export async function launch(ctx:Context,l:Launch,task:string): Promise<number> {
  verifyLaunch(ctx,l);
  const start=Date.now(),runId=randomUUID();
  record(ctx,{event:'start',runId,profile:l.profile,provider:l.role.provider,model:l.role.model,agent:l.command});
  if(l.manualTask) console.log('Freebuff is interactive and has no documented task flag. Paste this task after it opens:\n'+task+'\n');
  return await new Promise<number>((resolve,reject)=>{
    const resolved=executable(ctx,l.command,l.args);
    const child=spawn(resolved.command,resolved.args,{cwd:l.project,env:l.env,stdio:'inherit',shell:false});
    child.once('error',e=>{record(ctx,{event:'finish',runId,exitCode:1,durationMs:Date.now()-start});reject(new UserError(`Cannot start ${l.command}: ${e.message}`));});
    child.once('exit',(code,signal)=>{const result=code??(signal?130:1);record(ctx,{event:'finish',runId,exitCode:result,durationMs:Date.now()-start});resolve(result);});
  });
}
export function rollback(ctx:Context): string {
  const folder=path.join(ctx.home,'backups');
  const files=existsSync(folder)?readdirSync(folder).filter(f=>f.endsWith('.json')).sort():[];
  const last=files.at(-1); if(!last)throw new UserError('No configuration backup is available');
  const previous=json(path.join(folder,last));
  if(previous.version!==1||!previous.providers)throw new UserError('Invalid configuration backup');
  atomic(path.join(ctx.home,'state.json'),previous);
  renameSync(path.join(folder,last),path.join(folder,last+'.restored'));
  return last;
}

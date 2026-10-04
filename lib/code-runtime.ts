import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { db } from './server';
import { codeProposal, type CodeProposal } from './code-policy';
export function codeRate(){const v=env.CODE_RUN_COST_MICROUSD;if(v===undefined||v.trim()==='')return null;const n=Number(v);return Number.isSafeInteger(n)&&n>=0&&n<=1000000?n:null;}
async function runner(path:string,payload?:unknown){
 if(!env.CODE_RUNNER_URL||!env.CODE_RUNNER_TOKEN||env.CODE_RUNNER_TOKEN.length<40)throw Error('Runner unavailable');
 const url=new URL(env.CODE_RUNNER_URL);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='coder'))throw Error('Runner must use HTTPS');
 const r=await fetch(new URL(path,url),{method:payload?'POST':'GET',headers:{Authorization:'Bearer '+env.CODE_RUNNER_TOKEN,'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined,redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('Runner unavailable');
 const reader=r.body?.getReader();if(!reader)throw Error('Runner returned no body');
 let text='',bytes=0;const decoder=new TextDecoder();
 try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>100000){await reader.cancel();throw Error('Runner response too large');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
 if(text.length>100000)throw Error('Runner response too large');return JSON.parse(text);
}
export async function codeReady(){if(codeRate()===null)return false;try{const r=await runner('/health');return r.ready===true&&r.runtime==='runsc'&&r.network===false}catch{return false}}
export async function codeContext(coinId:string){
 const rows=await db().prepare('SELECT id,status,payload,result,updated_at FROM code_jobs WHERE coin_id=? ORDER BY created_at DESC LIMIT 3').bind(coinId).all<{id:string;status:string;payload:string;result:string|null;updated_at:number}>();
 return {available:await codeReady(),costMicrousd:codeRate(),pending:rows.results.some(r=>['queued','running'].includes(r.status)),
  workspace:rows.results[0]?codeProposal.parse(JSON.parse(rows.results[0].payload)).files:[],
  runs:rows.results.map(r=>({id:r.id,status:r.status,goal:JSON.parse(r.payload).goal,result:r.result?JSON.parse(r.result):null,updatedAt:r.updated_at}))};
}
export async function validateCodeProposal(coinId:string,proposal:CodeProposal,available:boolean){
 if(!available||codeRate()===null)throw Error('Coding sandbox unavailable');
 if(await db().prepare("SELECT id FROM code_jobs WHERE coin_id=? AND status IN ('queued','running') LIMIT 1").bind(coinId).first())throw Error('A code job is already pending');
 const previous=await db().prepare('SELECT payload FROM code_jobs WHERE coin_id=? ORDER BY created_at DESC LIMIT 1').bind(coinId).first<{payload:string}>();
 if(previous){const prior=JSON.parse(previous.payload);if(JSON.stringify({...prior,goal:''})===JSON.stringify({...proposal,goal:''}))throw Error('Inspect the previous result and change the code or tests before retrying');}
}
export function codeStatements(lease:{coinId:string;id:string},runId:string,proposal:CodeProposal,now:number){
 const rate=codeRate();if(rate===null)throw Error('Coding rate unavailable');
 return [db().prepare(`INSERT INTO code_jobs(id,coin_id,status,payload,cost_microusd,created_at,updated_at) SELECT ?,?,'queued',?,?,?,?
 WHERE EXISTS(SELECT 1 FROM runtime_leases l JOIN coins c ON c.id=l.coin_id WHERE l.coin_id=? AND l.lease_id=? AND l.lease_until>? AND c.ai_credit_microusd>=? AND json_extract(c.config,'$.lastPlanRunId')=?)
 AND NOT EXISTS(SELECT 1 FROM code_jobs WHERE coin_id=? AND status IN ('queued','running')) ON CONFLICT(id) DO NOTHING`).bind(runId,lease.coinId,JSON.stringify(proposal),rate,now,now,lease.coinId,lease.id,now,rate,runId,lease.coinId),
 db().prepare("UPDATE coins SET ai_credit_microusd=ai_credit_microusd-? WHERE id=? AND EXISTS(SELECT 1 FROM code_jobs WHERE id=? AND status='queued' AND created_at=?) AND NOT EXISTS(SELECT 1 FROM agent_runs WHERE id=?)").bind(rate,lease.coinId,runId,now,'code:'+runId),
 db().prepare("INSERT INTO agent_runs(id,coin_id,kind,status,reserved_microusd,created_at) SELECT ?,coin_id,'code','reserved',cost_microusd,? FROM code_jobs WHERE id=? ON CONFLICT(id) DO NOTHING").bind('code:'+runId,new Date(now).toISOString(),runId)];
}
const stepResult=z.object({exitCode:z.number().int(),timedOut:z.boolean(),output:z.string().max(8000)}).strict();
const resultInput=z.union([z.object({execution:stepResult,tests:stepResult.nullable()}).strict(),z.object({error:z.string().max(300)}).strict()]);
export async function runCodeTick(){
 if(!await codeReady())return {processed:false,reason:'sandbox_unavailable'};
 const job=await db().prepare("SELECT * FROM code_jobs WHERE status IN ('queued','running') ORDER BY updated_at LIMIT 1").first<{id:string;coin_id:string;status:string;payload:string;cost_microusd:number}>();
 if(!job)return {processed:false};
 const receipt=await runner('/jobs/'+job.id,codeProposal.parse(JSON.parse(job.payload)));
 if(receipt.id!==job.id)throw Error('Coding receipt mismatch');
 if(receipt.status==='running'){await db().prepare("UPDATE code_jobs SET status='running',updated_at=? WHERE id=? AND status IN ('queued','running')").bind(Date.now(),job.id).run();return {processed:true};}
 const result=resultInput.parse(receipt.result),success='execution' in result&&result.execution.exitCode===0&&result.tests?.exitCode===0&&!result.execution.timedOut&&!result.tests.timedOut;
 if(!['complete','failed'].includes(receipt.status)||(receipt.status==='complete')!==success)throw Error('Invalid coding receipt');
 const status=success?'complete':'failed',now=Date.now();
 await db().batch([
 db().prepare("UPDATE agent_runs SET status='settled',cost_microusd=reserved_microusd,output=?,finished_at=? WHERE id=? AND status='reserved' AND EXISTS(SELECT 1 FROM code_jobs WHERE id=? AND status IN ('queued','running'))").bind(JSON.stringify(result),new Date(now).toISOString(),'code:'+job.id,job.id),
 db().prepare("UPDATE code_jobs SET status=?,result=?,updated_at=? WHERE id=? AND status IN ('queued','running')").bind(status,JSON.stringify(result),now,job.id),
 db().prepare("INSERT INTO events(id,coin_id,owner,name,message,created_at) SELECT ?,id,owner,json_extract(config,'$.name'),?,? FROM coins WHERE id=? ON CONFLICT(id) DO NOTHING").bind('code:'+job.id,success?'Coding run finished: program and tests exited successfully.':'Coding run failed; the agent can inspect the result and revise its code.',new Date(now).toISOString(),job.coin_id),
 ]);return {processed:true,status};
}

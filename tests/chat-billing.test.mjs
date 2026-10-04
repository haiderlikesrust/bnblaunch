import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
register('./chat-billing-loader.mjs',import.meta.url);
const env=globalThis.__shenTestEnv={OPENROUTER_API_KEY:'test',CHAT_DAILY_LIMIT_MICROUSD:'100000000'};
const {POST}=await import('../app/api/coins/[id]/chat/route.ts');
const {digest}=await import('../lib/auth.ts');
const {DEFAULT_AGENT_MODEL,GUARDRAIL_MODEL}=await import('../lib/agent-models.ts');
const originalFetch=globalThis.fetch;
async function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const name of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+name,'utf8'));
 function prepare(query,values=[]){return {bind(...v){return prepare(query,v)},async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}}},async all(){return {results:sql.prepare(query).all(...values)}},async first(){return sql.prepare(query).get(...values)??null}}}
 env.DB={prepare,async batch(statements){sql.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sql.exec('COMMIT');return result}catch(error){sql.exec('ROLLBACK');throw error}}};
 const now=Date.now(),minute=Math.floor(now/60000)%60;
 // Pick an hourly phase open now; the test uses the real scheduler and SQL clock.
 let id;for(let i=0;i<10000;i++){const candidate='chat-'+i;let hash=0;for(const c of candidate)hash=(hash*31+c.charCodeAt(0))>>>0;if(hash%60===minute){id=candidate;break}}
 assert.ok(id);const token='0x1111111111111111111111111111111111117777',coin={id,name:'Community',symbol:'MIND',description:'A community documenting verified progress.',purpose:'Explain the project.',modelId:DEFAULT_AGENT_MODEL,language:'en',threshold:.1,balance:1,treasuryObservedAt:now,state:'active',website:true,images:false,social:false,research:false,tokenAddress:token};
 sql.prepare('INSERT INTO coins(id,owner,config,token_address,created_at,updated_at,ai_credit_microusd) VALUES(?,?,?,?,?,?,?)').run(id,'owner',JSON.stringify(coin),token,new Date(now).toISOString(),new Date(now).toISOString(),1000000);
 sql.prepare('INSERT INTO compute_funding(settlement_id,coin_id,amount_microusd,settled_at) VALUES(?,?,?,?)').run('funding',id,100000000,Math.floor(now/3600000)*3600000-1);
 globalThis.__chatTestSession='a'.repeat(64);sql.prepare('INSERT INTO wallet_sessions(id,wallet,expires_at) VALUES(?,?,?)').run(await digest(globalThis.__chatTestSession),'viewer',now+3600000);
 let modifyReply=reply=>reply;const calls=[];const json=value=>new Response(JSON.stringify(value));
 globalThis.fetch=async(url,init={})=>{const u=String(url);
  if(u.endsWith('/v1/models'))return json({data:[...new Set([DEFAULT_AGENT_MODEL,GUARDRAIL_MODEL])].map(modelId=>({id:modelId,pricing:{prompt:'0.000001',completion:'0.000001'},supported_parameters:['response_format']}))});
  if(u.endsWith('/chat/completions')){const body=JSON.parse(init.body);calls.push(body);const stage=calls.length;return json(modifyReply({choices:[{finish_reason:'stop',message:{content:JSON.stringify(stage===2?{answer:'My purpose is to explain the project.'}:{allow:true,reason:'question'})}}],usage:{cost:.0001}},stage))}
  throw Error('Unexpected external call '+u);
 };
 return {sql,calls,id,modifyReply(fn){modifyReply=fn},async post(){return POST(new Request('https://shen.test/api/coins/'+id+'/chat',{method:'POST',headers:{origin:'https://shen.test','content-type':'application/json'},body:JSON.stringify({message:'What is your purpose?'})}),{params:Promise.resolve({id})})},close(){sql.close();globalThis.fetch=originalFetch;delete globalThis.__chatTestSession}};
}
function assertSettled(f,cost){const run=f.sql.prepare('SELECT status,cost_microusd FROM chat_runs').get();assert.equal(run.status,'settled');assert.equal(run.cost_microusd,cost);assert.equal(f.sql.prepare('SELECT ai_credit_microusd AS credit FROM coins').get().credit,1000000-cost);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM agent_operations').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM agent_runs').get().n,0)}
test('public Q&A settles all three verified costs after successful guards',async()=>{
 const f=await fixture();try{const response=await f.post();assert.equal(response.status,200);assert.equal((await response.json()).blocked,false);assert.equal(f.calls.length,3);assertSettled(f,300)}finally{f.close()}
});
test('Q&A validates the public origin behind a proxy and rejects foreign origins',async()=>{
 const f=await fixture();env.APP_ORIGIN='https://shen.test';env.SHEN_RUNTIME='node';
 try{
  const request=origin=>new Request('http://web:3000/api/coins/'+f.id+'/chat',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({message:'What is your purpose?'})});
  const params={params:Promise.resolve({id:f.id})};
  assert.equal((await POST(request('https://attacker.test'),params)).status,403);
  assert.equal(f.calls.length,0);
  assert.equal((await POST(request('https://shen.test'),params)).status,200);
  assertSettled(f,300);
 }finally{delete env.APP_ORIGIN;delete env.SHEN_RUNTIME;f.close()}
});
for(const [kind,stage] of [['truncated',1],['invalid-json',2],['missing-message',3],['tool-call',2],['extra-choice',1]])test(`Q&A settles verified ${kind} output without further calls or actions`,async()=>{
 const f=await fixture();try{
  f.modifyReply((reply,current)=>{if(current!==stage)return reply;if(kind==='truncated')reply.choices[0].finish_reason='length';else if(kind==='invalid-json')reply.choices[0].message.content='not JSON';else if(kind==='missing-message')delete reply.choices[0].message;else if(kind==='tool-call')reply.choices[0].message.tool_calls=[{name:'post'}];else reply.choices.push(reply.choices[0]);return reply});
  assert.equal((await f.post()).status,503);assert.equal(f.calls.length,stage);assertSettled(f,stage*100);
 }finally{f.close()}
});
for(const kind of ['missing-receipt','over-ceiling','timeout'])test(`Q&A holds the entire reservation after ${kind} even when its first guard was billed`,async()=>{
 const f=await fixture();try{
  f.modifyReply((reply,stage)=>{if(stage!==2)return reply;if(kind==='timeout')throw Error('Provider timeout');if(kind==='missing-receipt')delete reply.usage;else reply.usage.cost=1;return reply});
  assert.equal((await f.post()).status,503);assert.equal(f.calls.length,2);const run=f.sql.prepare('SELECT status,cost_microusd,reserved_microusd FROM chat_runs').get();assert.equal(run.status,'reserved');assert.equal(run.cost_microusd,null);assert.equal(f.sql.prepare('SELECT ai_credit_microusd AS credit FROM coins').get().credit,1000000-run.reserved_microusd);
 }finally{f.close()}
});
test('a Q&A session closed during a billed reply settles it and makes no later guard call',async()=>{
 const f=await fixture();try{f.modifyReply((reply,stage)=>{if(stage===2)f.sql.prepare('INSERT INTO agent_chat_control(coin_id,closed_until) VALUES(?,?)').run(f.id,Date.now()+3600000);return reply});assert.equal((await f.post()).status,423);assert.equal(f.calls.length,2);assertSettled(f,200)}finally{f.close()}
});

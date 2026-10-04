import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createDatabase, migratePostgres } from '../server/postgres.mjs';
import { resolve } from 'node:path';
register('./planner-loader.mjs',import.meta.url);
const env=globalThis.__shenTestEnv={OPENROUTER_API_KEY:'test',OPENROUTER_MANAGEMENT_KEY:'test',SIGNER_URL:'https://signer.test',SIGNER_WEB_TOKEN:'test-only-'.repeat(6)};
const {runAgentTick}=await import('../lib/runtime.ts');
const {publishedWebsite}=await import('../lib/websites.ts');
const {agentPlan}=await import('../lib/runtime-policy.ts');
const {boundedPlanningContext,contextBytes}=await import('../lib/planning-context.ts');
const {DEFAULT_AGENT_MODEL,GUARDRAIL_MODEL}=await import('../lib/agent-models.ts');
const originalFetch=globalThis.fetch;
const token='0x1111111111111111111111111111111111117777',wallet='0x2222222222222222222222222222222222222222',processor='0x3333333333333333333333333333333333333333';
const site={title:'A community with a curious mind',tagline:'Research, explain, create.',about:'A community exploring verified developments on BNB.',theme:'jade',layout:'editorial',sections:[{heading:'Our purpose',body:'Explain verified progress.'}],faq:[{question:'Who manages the agent?',answer:'The agent operates independently after launch.'}]};
const plan={summary:'Publish the community website.',nextCheckMinutes:60,closeChatMinutes:0,transaction:{kind:'none',amountWei:'0',reason:'No transaction needed.'},website:site,publication:null};

test('a longer explanatory summary still requires review and persists as plan memory',async()=>{
 const f=fixture();try{
  const summary='Explain the research findings and continue useful community work. '.repeat(10);
  f.output({...plan,summary});assert.equal((await runAgentTick(['autonomous-planning'])).reason,'plan_completed');
  assert.equal(f.calls.length,2);assert.equal(f.sql.prepare('SELECT summary FROM agent_memories').get().summary,summary.trim());
 }finally{f.close();}
});
test('schema rejection records safe field feedback and the next attempt can correct it',async()=>{
 const f=fixture();try{
  f.output({...plan,summary:'private text '.repeat(200)});
  const rejected=await runAgentTick(['autonomous-planning']);
  assert.match(rejected.rejection.message,/summary: exceeds the maximum of 2000/);
  assert.equal(JSON.stringify(rejected).includes('private text'),false);
  assert.equal(f.calls.length,1);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM events').get().n,0);
  assert.equal(f.sql.prepare('SELECT ai_credit_microusd AS credit FROM coins').get().credit,999900);
  f.output(plan);f.due();assert.equal((await runAgentTick(['autonomous-planning'])).reason,'plan_completed');
  const retry=JSON.parse(f.calls[1].messages[1].content);
  assert.equal(retry.previousRejection.code,'schema');assert.equal(retry.previousRejection.issues[0].path[0],'summary');
  assert.equal(f.calls.length,3,'corrected plan still requires independent review');
 }finally{f.close();}
});
test('policy and guard rejections retain corrective feedback without returning private reviewer prose',async()=>{
 const f=fixture();try{
  f.output({...plan,task:{id:null,goal:'Read Mars science',nextStep:'Find a source',status:'active',evidence:{kind:'research',id:'made-up'}}});
  const rejected=await runAgentTick(['autonomous-planning']);
  assert.match(rejected.rejection.message,/Only completed tasks carry completion evidence/);
  f.output(plan);f.due();f.modifyReply((reply,guard)=>{if(guard)reply.choices[0].message.content=JSON.stringify({allow:false,reason:'private reviewer feedback'});return reply;});
  const guarded=await runAgentTick(['autonomous-planning']);assert.equal(guarded.rejection.code,'guard_denied');assert.equal(JSON.stringify(guarded).includes('private reviewer'),false);
  f.due();await runAgentTick(['autonomous-planning']);
  assert.equal(JSON.parse(f.calls[3].messages[1].content).previousRejection.reviewReason,'private reviewer feedback');
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM events').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM agent_tasks').get().n,0);
 }finally{f.close();}
});
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const name of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+name,'utf8'));
 function prepare(query,values=[]){return {bind(...v){return prepare(query,v)},async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}}},async all(){return {results:sql.prepare(query).all(...values)}},async first(){return sql.prepare(query).get(...values)??null}}}
 env.DB={prepare,async batch(statements){sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('COMMIT');return result}catch(e){sql.exec('ROLLBACK');throw e}}};
 const now=Date.now(),coin={id:'coin',name:'Community',symbol:'MIND',description:'A community documenting verified progress.',purpose:'Explain the project.',modelId:DEFAULT_AGENT_MODEL,language:'en',threshold:.1,balance:1,state:'active',website:true,images:false,social:false,research:false,tokenAddress:token,treasuryAddress:wallet};
 sql.prepare('INSERT INTO coins(id,owner,config,token_address,treasury_address,created_at,updated_at,ai_credit_microusd) VALUES(?,?,?,?,?,?,?,?)').run('coin','owner',JSON.stringify(coin),token,wallet,new Date(now).toISOString(),new Date(now).toISOString(),1000000);
 globalThis.__plannerChain={getChainId:async()=>56,getBlock:async()=>({number:100n,hash:'0x'+'a'.repeat(64),timestamp:BigInt(Math.floor(Date.now()/1000))}),readContract:async({functionName})=>{
  const values={balanceOf:0n,taxProcessor:processor,taxToken:token,marketAddress:wallet,weth:'0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',feeConfigV2:{isWeth:true,marketBps:10000,lpBps:0,dividendBps:0,deflationBps:0},totalQuoteSentToMarketing:1000000n,marketQuoteBalance:5n,decimals:8,latestRoundData:[1n,60000000000n,0n,BigInt(Math.floor(Date.now()/1000)),1n]};if(!(functionName in values))throw Error(functionName);return values[functionName];}};
 let walletResult={protocolReserveWei:"0",feeAccountingReady:true},expiry=false,reject=false,fail=false,output=plan,modifyReply=(reply)=>reply;const calls=[];
 const json=v=>new Response(JSON.stringify(v));
 globalThis.fetch=async(url,init={})=>{const u=String(url);
  if(u.endsWith('/balance'))return json({address:wallet,tokenAddress:token,balanceWei:'1000000000000000000',observedAt:now,block:'100',...walletResult});
  if(u.endsWith('/v1/status'))return json({chainId:56,signingReady:true,settlementAddress:wallet,gasReserveWei:'2000000000000000',buybacksEnabled:false});
  if(u.endsWith('/v1/models'))return json({data:[...new Set([DEFAULT_AGENT_MODEL,GUARDRAIL_MODEL])].map(id=>({id,pricing:{prompt:'0.000001',completion:'0.000001'},supported_parameters:['response_format','reasoning'],reasoning:{supported_efforts:['max','high','low'],mandatory:true}}))});
  if(u.endsWith('/v1/credits'))return json({data:{total_credits:100000,total_usage:0}});
  if(u.includes('geckoterminal'))return json({data:{id:'bsc_'+token,attributes:{address:token,market_cap_usd:'42000',fdv_usd:'50000',price_usd:'.01',total_reserve_in_usd:'5000',volume_usd:{h24:'900'}},relationships:{top_pools:{data:[]}}}});
  if(u.endsWith('/chat/completions')){const body=JSON.parse(init.body);calls.push(body);const guard=body.messages[0].content.startsWith('Independently');if(fail)throw Error('Provider timeout');if(guard&&expiry)sql.prepare('UPDATE runtime_leases SET lease_until=0').run();return json(modifyReply({choices:[{finish_reason:'stop',message:{content:JSON.stringify(guard?{allow:!reject,reason:'Checked'}:output)}}],usage:{cost:.0001}},guard))}
  throw Error('Unexpected external call '+u);
 };
 return {sql,calls,coin,wallet(value){walletResult=value},expire(){expiry=true},reject(){reject=true},fail(){fail=true},output(value){output=value},modifyReply(value){modifyReply=value},due(){sql.prepare('UPDATE runtime_leases SET next_run_at=0,next_plan_at=0').run()},close(){sql.close();globalThis.fetch=originalFetch}};
}
test('funded planner has no daily money cap, receives market/fee/cost context and publishes a real site',async()=>{
 const f=fixture();try{
  f.sql.prepare("INSERT INTO agent_runs(id,coin_id,kind,status,reserved_microusd,cost_microusd,created_at) VALUES('past','coin','plan','settled',0,9000000000,?)").run(new Date().toISOString());
  const result=await runAgentTick(['autonomous-planning']);assert.equal(result.reason,'plan_completed');
  const snapshot=JSON.parse(f.calls[0].messages[1].content);assert.equal(snapshot.spending.dailyMonetaryLimit,null);assert.equal(Number(snapshot.spending.serviceCostMicrousd.lastHour),9000000000);assert.equal(snapshot.spending.market.valuation.marketCapUsd,42000);assert.equal(snapshot.spending.feeFlow.status,'baseline');assert.equal(snapshot.hasPublishedWebsite,false);assert.equal(f.calls[0].max_tokens,8192);assert.equal(f.calls[1].max_tokens,4096);assert.equal(f.calls[0].reasoning.effort,'low');assert.equal(f.calls[1].reasoning.effort,'low');const reservation=f.sql.prepare('SELECT reserved_microusd FROM agent_runs WHERE reserved_microusd>0 LIMIT 1').get();assert.equal(reservation.reserved_microusd,124308);
  const live=await publishedWebsite('coin');assert.equal(live.site.title,site.title);assert.equal(live.site.url,'/sites/coin');assert.equal(live.site.revision,1);assert.equal(f.sql.prepare('SELECT ai_credit_microusd AS credit FROM coins').get().credit,999800);
  f.due();await runAgentTick(['autonomous-planning']);assert.equal((await publishedWebsite('coin')).site.revision,1,'identical content does not create another revision');
 }finally{f.close()}
});
test('a rejected update or ambiguous provider failure preserves the last committed site',async()=>{
 const f=fixture();try{await runAgentTick(['autonomous-planning']);f.due();f.output({...plan,website:{...site,title:'Unverified replacement'}});f.reject();assert.equal((await runAgentTick(['autonomous-planning'])).reason,'plan_rejected');assert.equal((await publishedWebsite('coin')).site.title,site.title);f.due();f.fail();await assert.rejects(runAgentTick(['autonomous-planning']));assert.equal((await publishedWebsite('coin')).site.revision,1)}finally{f.close()}
});
test('a funded first plan can defer publishing its website',async()=>{
 const f=fixture();try{f.output({...plan,website:null});assert.equal((await runAgentTick(['autonomous-planning'])).reason,'plan_completed');assert.equal(await publishedWebsite('coin'),null);const snapshot=JSON.parse(f.calls[0].messages[1].content);assert.equal(snapshot.canPublishWebsite,true);assert.equal(snapshot.hasPublishedWebsite,false);assert.equal(snapshot.websiteTiming.priority,'growing');}finally{f.close()}
});
test('autonomous service prepayment honors the SolCard minimum without calling a paid model',async()=>{
 const f=fixture();env.SIGNER_SETTLEMENT_ADDRESS='0x4ed72eb56621de657d62007bc7a798d314d9765b';try{
  f.sql.prepare('UPDATE coins SET ai_credit_microusd=0').run();
  assert.equal((await runAgentTick(['autonomous-planning'])).reason,'service_payment_queued');
  const payment=f.sql.prepare('SELECT kind,amount_wei,reserved_microusd FROM agent_operations').get();
  assert.equal(payment.kind,'compute');assert.equal(payment.amount_wei,'10000000000000000');assert.equal(payment.reserved_microusd,7200000);assert.equal(f.calls.length,0);
 }finally{delete env.SIGNER_SETTLEMENT_ADDRESS;f.close();}
});
test('guarded agent reward proposal enters the durable queue without public recipient controls',async()=>{
 const f=fixture();try{f.output({...plan,website:null,transaction:{kind:'rewards',amountWei:'10000000000000000',reason:'Distribute an affordable share of fee income.'}});assert.equal((await runAgentTick(['autonomous-planning'])).reason,'plan_completed');const operation=f.sql.prepare('SELECT kind,amount_wei,status FROM agent_operations').get();assert.equal(operation.kind,'rewards');assert.equal(operation.status,'queued');assert.equal(operation.amount_wei,'10000000000000000');assert.ok(Array.isArray(JSON.parse(f.calls[0].messages[1].content).recentTreasuryActions));}finally{f.close();}
});
for(const rejectGuard of [false,true])test(`a truncated ${rejectGuard?'guard':'planner'} response settles its verified cost and allows the next plan`,async()=>{
 const f=fixture();try{
  f.modifyReply((reply,guard)=>{if(guard===rejectGuard)reply.choices[0].finish_reason='length';return reply});
  assert.equal((await runAgentTick(['autonomous-planning'])).reason,rejectGuard?'guard_output_truncated':'planner_output_truncated');assert.equal(f.calls.length,rejectGuard?2:1);assert.equal(await publishedWebsite('coin'),null);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM events').get().n,0);
  const run=f.sql.prepare('SELECT status,cost_microusd FROM agent_runs').get();assert.equal(run.status,'settled');assert.equal(run.cost_microusd,rejectGuard?200:100);assert.equal(f.sql.prepare('SELECT ai_credit_microusd AS credit FROM coins').get().credit,1000000-run.cost_microusd);
  f.modifyReply(reply=>reply);f.due();assert.equal((await runAgentTick(['autonomous-planning'])).reason,'plan_completed');assert.equal((await publishedWebsite('coin')).site.revision,1);
 }finally{f.close()}
});
for(const invalid of ['missing','negative','unsafe','over-ceiling'])test(`a ${invalid} cost receipt keeps the planner reservation even when output is rejected`,async()=>{
 const f=fixture();try{
  f.modifyReply(reply=>{reply.choices[0].finish_reason='length';if(invalid==='missing')delete reply.usage;else reply.usage.cost=invalid==='negative'?-.001:invalid==='unsafe'?1e20:1;return reply});
  await assert.rejects(runAgentTick(['autonomous-planning']),/awaiting reconciliation/);const run=f.sql.prepare('SELECT status,cost_microusd,reserved_microusd FROM agent_runs').get();assert.equal(run.status,'reserved');assert.equal(run.cost_microusd,null);assert.equal(f.sql.prepare('SELECT ai_credit_microusd AS credit FROM coins').get().credit,1000000-run.reserved_microusd);assert.equal(await publishedWebsite('coin'),null);
  f.due();assert.equal((await runAgentTick(['autonomous-planning'])).reason,'provider_cost_reconciliation_required');assert.equal(f.calls.length,1);
 }finally{f.close()}
});
test('an expired planning lease cannot publish a website',async()=>{
 const f=fixture();try{f.expire();await assert.rejects(runAgentTick(['autonomous-planning']),/lease expired/);assert.equal(await publishedWebsite('coin'),null);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM events').get().n,0)}finally{f.close()}
});

test('approved plans persist coin-scoped memory and the next cycle receives it',async()=>{
 const f=fixture();try{
  f.output({...plan,memory:'Follow up on the community website and verify its published revision.'});
  await runAgentTick(['autonomous-planning']);
  const saved=f.sql.prepare('SELECT summary,next_steps FROM agent_memories WHERE coin_id=?').get('coin');
  assert.equal(saved.summary,plan.summary);assert.match(saved.next_steps,/verify its published revision/);
  f.due();await runAgentTick(['autonomous-planning']);
  const memory=JSON.parse(f.calls[2].messages[1].content).memory;
  assert.match(memory.kind,/not proof of execution/);assert.equal(memory.entries[0].nextSteps,saved.next_steps);
  const {agentMemory}=await import('../lib/agent-memory.ts');assert.deepEqual((await agentMemory('another-coin')).entries,[]);
 }finally{f.close()}
});

for(const mode of ['rejected','expired'])test(`${mode} plans cannot write agent memory`,async()=>{
 const f=fixture();try{
  if(mode==='rejected'){f.reject();await runAgentTick(['autonomous-planning']);}
  else{f.expire();await assert.rejects(runAgentTick(['autonomous-planning']),/lease expired/);}
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM agent_memories').get().n,0);
 }finally{f.close()}
});

test('model usage records actual token receipts and preserves unknown costs for reconciliation',async()=>{
 const f=fixture();try{
  f.modifyReply(reply=>({...reply,id:'generation-receipt',usage:{cost:.0001,prompt_tokens:101,completion_tokens:22,prompt_tokens_details:{cached_tokens:12},completion_tokens_details:{reasoning_tokens:8}}}));
  await runAgentTick(['autonomous-planning']);
  const usage=f.sql.prepare('SELECT * FROM model_usage ORDER BY created_at').all();assert.equal(usage.length,2);
  assert.equal(usage[0].prompt_tokens,101);assert.equal(usage[0].cached_tokens,12);assert.equal(usage[0].reasoning_tokens,8);assert.equal(usage[0].cost_microusd,100);assert.equal(usage[0].status,'recorded');
  f.due();f.modifyReply(reply=>{delete reply.usage;return reply});await assert.rejects(runAgentTick(['autonomous-planning']),/awaiting reconciliation/);
  const unknown=f.sql.prepare("SELECT * FROM model_usage WHERE status='reconciliation_required'").get();assert.equal(unknown.cost_microusd,null);assert.equal(unknown.prompt_tokens,null);
 }finally{f.close()}
});
test('website content rejects arbitrary code fields, links and unsupported themes',()=>{
 for(const invalid of [{...site,html:'<script>alert(1)</script>'},{...site,url:'https://evil.example'},{...site,theme:'javascript:'},{...site,sections:[{heading:'Hello',body:'Text',script:'x'}]}])assert.equal(agentPlan.safeParse({...plan,website:invalid}).success,false);
});
test('large Chinese history fits the byte budget without dropping the mission or financial signals',()=>{
 const snapshot={mission:'使命'.repeat(700),treasuryWei:'1000000000000000000',sources:Array.from({length:3},()=>({description:'研究'.repeat(500)})),community:{recent:Array.from({length:5},()=>({text:'内容'.repeat(1200)}))},website:{about:'故事'.repeat(1800)},spending:{market:{marketCapUsd:100000,lastCandles:Array.from({length:12},()=>({time:Date.now(),open:1,high:2,low:.5,close:1.5}))}}};
 const result=boundedPlanningContext('Follow the mission.',snapshot);assert.ok(contextBytes('Follow the mission.',result)<=31000);assert.equal(result.mission,snapshot.mission);assert.equal(result.treasuryWei,snapshot.treasuryWei);assert.equal(result.spending.market.marketCapUsd,100000);assert.equal(result.contextTruncated,true);assert.equal(snapshot.community.recent.length,5);
});
test('the real funded planner and website revision transaction execute against PostgreSQL',async()=>{
 const f=fixture(),pg=new PGlite();await pg.waitReady;
 try{
  await migratePostgres({query:(sql,params)=>params?pg.query(sql,params):pg.exec(sql).then(r=>r[0]??{rows:[]})},resolve('drizzle'));
  await pg.query('INSERT INTO coins(id,owner,config,token_address,treasury_address,created_at,updated_at,ai_credit_microusd) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',['coin','owner',JSON.stringify(f.coin),token,wallet,new Date().toISOString(),new Date().toISOString(),1000000]);
  // One PGlite connection; serialize pool checkout just like a real pool client.
  let tail=Promise.resolve();env.DB=createDatabase({async connect(){const prior=tail;let release;tail=new Promise(r=>{release=r});await prior;return {async query(sql,params){const result=await pg.query(sql,params);return {...result,rowCount:result.affectedRows??result.rows.length}},release}}});
  const result=await runAgentTick(['autonomous-planning']);assert.equal(result.reason,'plan_completed');assert.equal(Number((await publishedWebsite('coin')).site.revision),1);assert.equal((await pg.query('SELECT status FROM agent_runs')).rows[0].status,'settled');
 }finally{await pg.close();f.close()}
});

test('guarded domain proposals require capability, a site and a separate affordable budget',async()=>{
 const f=fixture(),keys=['SHEN_RUNTIME','DOMAIN_AUTO_FUNDING_ENABLED','PORKBUN_API_KEY','PORKBUN_SECRET_KEY','DOKPLOY_URL','DOKPLOY_API_KEY','DOKPLOY_COMPOSE_ID','HOSTING_IPV4'],previous=Object.fromEntries(keys.map(k=>[k,env[k]]));
 try{
  Object.assign(env,{SHEN_RUNTIME:'node',DOMAIN_AUTO_FUNDING_ENABLED:'true',PORKBUN_API_KEY:'test',PORKBUN_SECRET_KEY:'test',DOKPLOY_URL:'https://deploy.test',DOKPLOY_API_KEY:'test',DOKPLOY_COMPOSE_ID:'test',HOSTING_IPV4:'8.8.4.4'});
  const domain={domain:'curiousmind.xyz',kind:'register',maxCostCents:1200,maxAnnualRenewalCents:1500,maxBnbWei:'50000000000000000',reason:'A memorable home.'};f.output({...plan,domain});
  assert.equal((await runAgentTick(['autonomous-planning'])).reason,'plan_rejected');assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM domain_orders').get().n,0);
  f.due();assert.equal((await runAgentTick(['autonomous-planning','custom-domains'])).reason,'plan_completed');assert.equal(f.sql.prepare('SELECT domain,status FROM domain_orders').get().domain,domain.domain);assert.equal(f.sql.prepare('SELECT status FROM domain_orders').get().status,'queued');
  assert.equal(agentPlan.safeParse({...plan,domain:{...domain,recipient:'0xbad'}}).success,false);
 }finally{for(const key of keys){if(previous[key]===undefined)delete env[key];else env[key]=previous[key];}f.close()}
});


test('wallet checks run within one minute without repeating a paid plan',async()=>{
 const f=fixture();try{
  await runAgentTick(['autonomous-planning']);
  const schedule=f.sql.prepare('SELECT next_run_at,next_plan_at FROM runtime_leases').get();
  assert.ok(schedule.next_run_at-Date.now()<=60000&&schedule.next_run_at>Date.now());
  assert.ok(schedule.next_plan_at-Date.now()>50000&&schedule.next_plan_at-Date.now()<=60000);
  const calls=f.calls.length;
  f.sql.prepare('UPDATE runtime_leases SET next_run_at=0').run();
  assert.equal((await runAgentTick(['autonomous-planning'])).reason,'awaiting_next_plan');
  assert.equal(f.calls.length,calls);
 }finally{f.close()}
});

test('unfunded agents recheck in thirty seconds without paid model calls',async()=>{
 const f=fixture();try{
  const coin={...f.coin,threshold:2};f.sql.prepare('UPDATE coins SET config=?').run(JSON.stringify(coin));
  assert.equal((await runAgentTick(['autonomous-planning'])).reason,'awaiting_treasury_funding');
  const schedule=f.sql.prepare('SELECT next_run_at FROM runtime_leases').get();
  assert.ok(schedule.next_run_at-Date.now()<=30000&&schedule.next_run_at>Date.now());
  assert.equal(f.calls.length,0);
 }finally{f.close()}
});


test('fee audit failure records real balance and reason without authorizing spending',async()=>{
 const f=fixture();try{
  f.wallet({protocolReserveWei:null,feeAccountingReady:false,feeAccountingIssue:'rpc_log_limit'});
  assert.equal((await runAgentTick(['autonomous-planning'])).reason,'rpc_log_limit');
  assert.equal(JSON.parse(f.sql.prepare('SELECT config FROM coins').get().config).balance,1);
  const checked=f.sql.prepare('SELECT last_checked_at,last_reason FROM runtime_leases').get();
  assert.ok(checked.last_checked_at>0);assert.equal(checked.last_reason,'rpc_log_limit');
  assert.equal(f.calls.length,0);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM agent_operations').get().n,0);
 }finally{f.close()}
});


test('disabled X does not block planning when unused X billing is invalid',async()=>{
 const f=fixture(),previous=env.X_READ_COST_MICROUSD;env.X_READ_COST_MICROUSD='';
 try{assert.equal((await runAgentTick(['autonomous-planning'])).reason,'plan_completed');assert.equal(f.calls.length,2);}
 finally{if(previous===undefined)delete env.X_READ_COST_MICROUSD;else env.X_READ_COST_MICROUSD=previous;f.close();}
});

test('missing research configuration leaves useful non-research planning available',async()=>{
 const f=fixture(),previous=env.BRAVE_COST_MICROUSD;delete env.BRAVE_COST_MICROUSD;
 try{
  f.sql.prepare('UPDATE coins SET config=?').run(JSON.stringify({...f.coin,research:true}));
  assert.equal((await runAgentTick(['autonomous-planning'])).reason,'plan_completed');
  assert.equal(JSON.parse(f.calls[0].messages[1].content).researchTools.available,false);
  assert.equal(f.calls.length,2);
 }finally{if(previous!==undefined)env.BRAVE_COST_MICROUSD=previous;f.close();}
});

test('a failed planner records its failure stage and keeps ambiguous credit reserved',async()=>{
 const f=fixture();try{
  f.fail();await assert.rejects(runAgentTick(['autonomous-planning']));
  assert.equal(f.sql.prepare('SELECT last_reason FROM runtime_leases').get().last_reason,'planner_request_failed');
  assert.equal(f.sql.prepare('SELECT status FROM agent_runs').get().status,'reserved');
 }finally{f.close();}
});


test('confirmed prepaid services remain usable after the deposit lowers BNB below activation',async()=>{
 const f=fixture();try{
  f.wallet({balanceWei:'6632000000000000',protocolReserveWei:'2494919121834000',feeAccountingReady:true});
  f.sql.prepare('UPDATE coins SET config=?,ai_credit_microusd=?').run(JSON.stringify({...f.coin,threshold:.01}),7800000);
  f.sql.prepare('INSERT INTO compute_funding(settlement_id,coin_id,amount_microusd,settled_at) VALUES(?,?,?,?)').run('confirmed-payment','coin',7800000,Date.now());
  assert.equal((await runAgentTick(['autonomous-planning'])).reason,'plan_completed');
  assert.equal(f.calls.length,2);
  const snapshot=JSON.parse(f.calls[0].messages[1].content);
  assert.equal(snapshot.availableWei,'2137080878166000');assert.equal(snapshot.gasReserveWei,'2000000000000000');
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM agent_operations').get().n,0);
  assert.equal(JSON.parse(f.sql.prepare('SELECT config FROM coins').get().config).state,'active');
  assert.equal(f.sql.prepare('SELECT ai_credit_microusd AS credit FROM coins').get().credit,7799800);
 }finally{f.close();}
});

for(const mode of ['unverified','empty','insufficient','fee_audit'])test('prepaid exception keeps funding safeguards: '+mode,async()=>{
 const f=fixture();try{
  f.wallet({balanceWei:'6632000000000000',protocolReserveWei:mode==='fee_audit'?null:'2494919121834000',feeAccountingReady:mode!=='fee_audit',feeAccountingIssue:'rpc_log_limit'});
  f.sql.prepare('UPDATE coins SET config=?,ai_credit_microusd=?').run(JSON.stringify({...f.coin,threshold:.01}),mode==='empty'?0:mode==='insufficient'?1:7800000);
  if(mode!=='unverified')f.sql.prepare('INSERT INTO compute_funding(settlement_id,coin_id,amount_microusd,settled_at) VALUES(?,?,?,?)').run('confirmed-payment','coin',7800000,Date.now());
  const expected=mode==='fee_audit'?'rpc_log_limit':mode==='insufficient'?'awaiting_service_funding':'awaiting_treasury_funding';
  assert.equal((await runAgentTick(['autonomous-planning'])).reason,expected);assert.equal(f.calls.length,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM agent_operations').get().n,0);
 }finally{f.close();}
});


for(const mode of ['planner-length','guard-length','schema','guard-rejection'])test('settled rejection retries immediately with a bounded burst: '+mode,async()=>{
 const f=fixture();try{
  if(mode==='schema')f.output({...plan,nextCheckMinutes:0});
  else if(mode==='guard-rejection')f.reject();
  else f.modifyReply((reply,guard)=>{if(guard===(mode==='guard-length'))reply.choices[0].finish_reason='length';return reply});
  for(let attempt=1;attempt<=3;attempt++){
   await runAgentTick(['autonomous-planning']);
   assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM agent_runs').get().n,attempt);
   const s=f.sql.prepare('SELECT next_run_at,next_plan_at FROM runtime_leases').get();
   if(attempt<3){assert.equal(s.next_plan_at,0);assert.ok(s.next_run_at<=Date.now());}
   else{assert.ok(s.next_plan_at>Date.now()+14*60000);assert.ok(s.next_run_at>Date.now());}
  }
  const calls=f.calls.length;
  f.sql.prepare('UPDATE runtime_leases SET next_run_at=0').run();
  assert.equal((await runAgentTick(['autonomous-planning'])).reason,'awaiting_next_plan');assert.equal(f.calls.length,calls);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM agent_operations').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM agent_memories').get().n,0);
 }finally{f.close();}
});

test('deployment wakes an old rejected plan without resetting approved or unsettled work',()=>{
 const f=fixture();try{
  f.sql.prepare('INSERT INTO runtime_leases(coin_id,lease_until,next_run_at,next_plan_at) VALUES(?,0,?,?)').run('coin',Date.now()+60000,Date.now()+900000);
  f.sql.prepare("INSERT INTO agent_runs(id,coin_id,kind,status,reserved_microusd,created_at) VALUES('retry','coin','plan','settled',100,?)").run(new Date().toISOString());
  const migration=readFileSync('drizzle/0026_wake_rejected_plans.sql','utf8');
  f.sql.exec(migration);assert.equal(f.sql.prepare('SELECT next_plan_at FROM runtime_leases').get().next_plan_at,0);
  f.sql.prepare('UPDATE runtime_leases SET next_plan_at=123').run();
  f.sql.prepare("UPDATE agent_runs SET status='reserved'").run();f.sql.exec(migration);assert.equal(f.sql.prepare('SELECT next_plan_at FROM runtime_leases').get().next_plan_at,123);
  f.sql.prepare("UPDATE agent_runs SET status='settled'").run();
  f.sql.prepare("INSERT INTO agent_memories VALUES('retry','coin','approved','',?)").run(Date.now());
  f.sql.exec(migration);assert.equal(f.sql.prepare('SELECT next_plan_at FROM runtime_leases').get().next_plan_at,123);
 }finally{f.close();}
});


test('approved community work queues local text and schedules a mission follow-up on a funded one-minute pulse',async()=>{
 const f=fixture();try{
  f.output({...plan,nextCheckMinutes:240,website:null,nextResearchQuery:'Mars atmosphere recent research findings',publication:{destination:'gallery',text:'Our mission is to explore Mars through research and original work.',imagePrompt:null,altText:''}});
  f.sql.prepare('UPDATE coins SET config=?').run(JSON.stringify({...f.coin,research:true}));
  const key=env.BRAVE_API_KEY,cost=env.BRAVE_COST_MICROUSD;env.BRAVE_API_KEY='test';env.BRAVE_COST_MICROUSD='5000';
  try{assert.equal((await runAgentTick(['autonomous-planning'])).reason,'plan_completed');}finally{if(key===undefined)delete env.BRAVE_API_KEY;else env.BRAVE_API_KEY=key;if(cost===undefined)delete env.BRAVE_COST_MICROUSD;else env.BRAVE_COST_MICROUSD=cost;}
  const job=f.sql.prepare('SELECT payload,status FROM content_jobs').get();assert.equal(job.status,'queued');assert.equal(JSON.parse(job.payload).destination,'gallery');
  const config=JSON.parse(f.sql.prepare('SELECT config FROM coins').get().config);assert.equal(config.nextResearchQuery,'Mars atmosphere recent research findings');
  const schedule=f.sql.prepare('SELECT next_plan_at FROM runtime_leases').get();assert.ok(schedule.next_plan_at<=Date.now()+5*60000);
  assert.equal(JSON.parse(f.calls[1].messages[1].content).plan.nextCheckMinutes,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM agent_operations').get().n,0);
 }finally{f.close();}
});

test('unapproved follow-up research never replaces the saved query',async()=>{
 const f=fixture();try{
  f.output({...plan,nextResearchQuery:'unapproved topic'});f.reject();await runAgentTick(['autonomous-planning']);
  assert.equal(JSON.parse(f.sql.prepare('SELECT config FROM coins').get().config).nextResearchQuery,undefined);
 }finally{f.close();}
});

test('community deployment wakes long approved waits but preserves reserved work',()=>{
 const f=fixture();try{
  f.sql.prepare('INSERT INTO runtime_leases(coin_id,lease_until,next_run_at,next_plan_at) VALUES(?,0,?,?)').run('coin',Date.now()+60000,Date.now()+4*3600000);
  f.sql.prepare("INSERT INTO agent_runs(id,coin_id,kind,status,reserved_microusd,created_at) VALUES('approved','coin','plan','settled',100,?)").run(new Date().toISOString());
  const migration=readFileSync('drizzle/0027_continue_community_work.sql','utf8');
  f.sql.exec(migration);assert.ok(f.sql.prepare('SELECT next_plan_at FROM runtime_leases').get().next_plan_at>Date.now());
  f.sql.prepare("INSERT INTO agent_memories VALUES('approved','coin','summary','',?)").run(Date.now());
  f.sql.exec(migration);assert.equal(f.sql.prepare('SELECT next_plan_at FROM runtime_leases').get().next_plan_at,0);
  f.sql.prepare('UPDATE runtime_leases SET next_plan_at=?').run(Date.now()+4*3600000);
  f.sql.prepare("UPDATE agent_runs SET status='reserved'").run();f.sql.exec(migration);assert.ok(f.sql.prepare('SELECT next_plan_at FROM runtime_leases').get().next_plan_at>Date.now());
 }finally{f.close();}
});

const {pulseMinutes,treasuryThesis}=await import('../lib/agent-work-policy.ts');
const task={id:null,goal:'Publish an introduction to our mission',nextStep:'Create a useful local community introduction',status:'active',evidence:null};

function holdImage(f){
 const publication={destination:'gallery',text:'An introduction',imagePrompt:'Original Mars art',altText:'Mars'};
 f.sql.prepare("INSERT INTO content_jobs(id,coin_id,payload,status,reserved_microusd,created_at,updated_at) VALUES('held','coin',?,'uncertain',50000,?,?)").run(JSON.stringify(publication),Date.now(),Date.now());
 f.sql.prepare("INSERT INTO agent_runs(id,coin_id,kind,status,reserved_microusd,created_at) VALUES('content:held','coin','content','reserved',50000,?)").run(new Date().toISOString());
 f.sql.exec('UPDATE coins SET ai_credit_microusd=ai_credit_microusd-50000');
}
test('an unresolved image keeps its credit hold while paid research and planning continue',async()=>{
 const f=fixture();let searches=0,step=0;env.BRAVE_API_KEY='test';env.BRAVE_COST_MICROUSD='5000';
 globalThis.__plannerResearch=async()=>{searches++;return [{title:'Mars',url:'https://science.nasa.gov/mars/',description:'Science source.'}]};
 try{
  holdImage(f);f.sql.prepare('UPDATE coins SET config=?').run(JSON.stringify({...f.coin,research:true,images:true}));
  f.modifyReply((reply,guard)=>{if(!guard&&step++===0)reply.choices[0].message.content=JSON.stringify({tool:'research',query:'Mars science discoveries'});return reply;});
  assert.equal((await runAgentTick(['autonomous-planning'])).reason,'plan_completed');assert.equal(searches,1);
  const snapshot=JSON.parse(f.calls[0].messages[1].content);assert.equal(snapshot.community.publicationPending,true);assert.equal(snapshot.canGenerateImages,false);
  assert.equal(f.sql.prepare("SELECT status FROM agent_runs WHERE id='content:held'").get().status,'reserved');
  assert.equal(f.sql.prepare('SELECT ai_credit_microusd credit FROM coins').get().credit,944700);
  assert.equal(f.sql.prepare('SELECT status FROM content_jobs').get().status,'uncertain');
 }finally{delete env.BRAVE_API_KEY;delete env.BRAVE_COST_MICROUSD;delete globalThis.__plannerResearch;f.close();}
});
for(const invalid of ['orphan','amount-mismatch'])test('an '+invalid+' content reservation still blocks spending',async()=>{
 const f=fixture();try{holdImage(f);f.sql.exec(invalid==='orphan'?"DELETE FROM content_jobs":"UPDATE content_jobs SET reserved_microusd=1");assert.equal((await runAgentTick(['autonomous-planning'])).reason,'provider_cost_reconciliation_required');assert.equal(f.calls.length,0);}finally{f.close();}
});
test('continuing plans cannot queue a duplicate publication while image confirmation is pending',async()=>{
 const f=fixture();try{holdImage(f);f.output({...plan,publication:{destination:'gallery',text:'Duplicate attempt',imagePrompt:null,altText:''}});assert.equal((await runAgentTick(['autonomous-planning'])).rejection.message.includes('A publication is already pending'),true);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM content_jobs').get().n,1);}finally{f.close();}
});
test('adaptive pulse preserves a six-hour credit runway and validates public spending targets',()=>{
 assert.equal(pulseMinutes(6000000,10000),1);assert.equal(pulseMinutes(600000,10000),6);assert.equal(pulseMinutes(0,10000),360);
 assert.equal(treasuryThesis.safeParse({buyback:15,rewards:25,reserve:30,creative:30,reason:'Balance useful work with runway.'}).success,true);
 assert.equal(treasuryThesis.safeParse({buyback:15,rewards:25,reserve:30,creative:90,reason:'Oversubscribed.'}).success,false);
});
test('tasks persist across cycles and completion requires a confirmed coin-scoped receipt',async()=>{
 const f=fixture();try{
  f.output({...plan,website:null,task,treasuryThesis:{buyback:0,rewards:25,reserve:35,creative:40,reason:'Keep operating runway before rewards.'}});
  assert.equal((await runAgentTick(['autonomous-planning'])).reason,'plan_completed');
  const saved=f.sql.prepare('SELECT * FROM agent_tasks').get();assert.equal(saved.goal,task.goal);
  assert.equal(JSON.parse(f.sql.prepare('SELECT config FROM coins').get().config).treasuryThesis.rewards,25);
  f.due();f.output({...plan,website:null,task:{...task,id:saved.id,status:'complete',evidence:{kind:'publication',id:'not-confirmed'}}});
  assert.equal((await runAgentTick(['autonomous-planning'])).reason,'plan_rejected');assert.equal(f.sql.prepare('SELECT status FROM agent_tasks').get().status,'active');
  assert.equal(JSON.parse(f.calls[2].messages[1].content).tasks[0].id,saved.id);
  f.sql.prepare("INSERT INTO content_jobs(id,coin_id,payload,status,created_at,updated_at) VALUES('published','coin','{}','complete',?,?)").run(Date.now(),Date.now());
  f.due();f.output({...plan,website:null,task:{...task,id:saved.id,status:'complete',nextStep:'Continue the next research question',evidence:{kind:'publication',id:'published'}}});
  assert.equal((await runAgentTick(['autonomous-planning'])).reason,'plan_completed');assert.equal(f.sql.prepare('SELECT status FROM agent_tasks').get().status,'complete');
 }finally{f.close();}
});
for(const mode of ['rejected','expired'])test(mode+' plans cannot save tasks or a treasury thesis',async()=>{
 const f=fixture();try{
  f.output({...plan,task,treasuryThesis:{buyback:0,rewards:25,reserve:35,creative:40,reason:'Preserve runway.'}});
  if(mode==='rejected'){f.reject();await runAgentTick(['autonomous-planning']);}else{f.expire();await assert.rejects(runAgentTick(['autonomous-planning']));}
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM agent_tasks').get().n,0);assert.equal(JSON.parse(f.sql.prepare('SELECT config FROM coins').get().config).treasuryThesis,undefined);
 }finally{f.close();}
});
test('research results feed the same cycle; repeating a recent question costs no second search',async()=>{
 const f=fixture();let searches=0,step=0;env.BRAVE_API_KEY='test';env.BRAVE_COST_MICROUSD='5000';
 globalThis.__plannerResearch=async coin=>{searches++;assert.equal(coin.nextResearchQuery,'Mars rover science');return [{title:'Rover results',url:'https://science.nasa.gov/mars/',description:'Verified source snippet.'}]};
 try{
  f.sql.prepare('UPDATE coins SET config=?').run(JSON.stringify({...f.coin,research:true}));
  f.modifyReply((reply,guard)=>{if(!guard&&step++%2===0)reply.choices[0].message.content=JSON.stringify({tool:'research',query:'Mars rover science'});return reply;});
  assert.equal((await runAgentTick(['autonomous-planning'])).reason,'plan_completed');assert.equal(searches,1);
  const snapshot=JSON.parse(f.calls[1].messages[1].content);assert.equal(snapshot.researchResults[0].sources[0].title,'Rover results');
  assert.equal(f.sql.prepare('SELECT cost_microusd FROM agent_runs').get().cost_microusd,5300);
  f.due();await runAgentTick(['autonomous-planning']);assert.equal(searches,1);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM research_runs').get().n,1);
  assert.equal(JSON.parse(f.calls[4].messages[1].content).researchResults[0].reused,true);
  assert.equal(f.sql.prepare('SELECT ai_credit_microusd AS c FROM coins').get().c,994400);
 }finally{delete env.BRAVE_API_KEY;delete env.BRAVE_COST_MICROUSD;delete globalThis.__plannerResearch;f.close();}
});
test('research loop has a hard paid-step limit and never queues rejected work',async()=>{
 const f=fixture();env.BRAVE_API_KEY='test';env.BRAVE_COST_MICROUSD='5000';try{
  f.sql.prepare('UPDATE coins SET config=?').run(JSON.stringify({...f.coin,research:true}));f.output({tool:'research',query:'Mars rover science'});
  assert.equal((await runAgentTick(['autonomous-planning'])).reason,'plan_rejected');assert.equal(f.calls.length,3);
  assert.equal(f.sql.prepare('SELECT cost_microusd FROM agent_runs').get().cost_microusd,5300);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM agent_operations').get().n,0);
 }finally{delete env.BRAVE_API_KEY;delete env.BRAVE_COST_MICROUSD;f.close();}
});
test('an uncertain follow-up model charge retains the whole cycle reservation',async()=>{
 const f=fixture();let step=0;env.BRAVE_API_KEY='test';env.BRAVE_COST_MICROUSD='5000';try{
  f.sql.prepare('UPDATE coins SET config=?').run(JSON.stringify({...f.coin,research:true}));f.modifyReply((reply,guard)=>{if(!guard){if(step++===0)reply.choices[0].message.content=JSON.stringify({tool:'research',query:'Mars research'});else delete reply.usage;}return reply;});
  await assert.rejects(runAgentTick(['autonomous-planning']),/reconciliation/);assert.equal(f.sql.prepare('SELECT status FROM agent_runs').get().status,'reserved');f.due();assert.equal((await runAgentTick(['autonomous-planning'])).reason,'provider_cost_reconciliation_required');
 }finally{delete env.BRAVE_API_KEY;delete env.BRAVE_COST_MICROUSD;f.close();}
});
test('a completed output wakes an approved slow pulse once and cannot bypass rejection backoff',async()=>{
 const f=fixture();try{
  await runAgentTick(['autonomous-planning']);const cfg=JSON.parse(f.sql.prepare('SELECT config FROM coins').get().config);
  f.sql.prepare('UPDATE agent_runs SET finished_at=?').run(new Date(Date.now()-61000).toISOString());f.sql.prepare('UPDATE runtime_leases SET next_run_at=0,next_plan_at=?').run(Date.now()+600000);
  f.sql.prepare("INSERT INTO content_jobs(id,coin_id,payload,status,created_at,updated_at) VALUES('done','coin','{}','complete',?,?)").run(Date.now(),cfg.workObservedAt+1);
  assert.equal((await runAgentTick(['autonomous-planning'])).reason,'plan_completed');const n=f.calls.length;
  f.sql.prepare('UPDATE runtime_leases SET next_run_at=0').run();assert.equal((await runAgentTick(['autonomous-planning'])).reason,'awaiting_next_plan');assert.equal(f.calls.length,n);
  const {hasNewWorkResult}=await import('../lib/agent-work.ts');assert.equal(await hasNewWorkResult('coin','wrong-run',0),false);
 }finally{f.close();}
});
test('browser opens only discovered sources and feeds genuine captures back into the plan',async()=>{
 const f=fixture();const fetchBefore=globalThis.fetch;env.BROWSER_URL='http://browser:8090';env.BROWSER_TOKEN='test-browser-token-'.repeat(4);env.BRAVE_API_KEY='test';env.BRAVE_COST_MICROUSD='5000';let step=0,captures=0;
 try{
  f.sql.prepare('UPDATE coins SET config=?').run(JSON.stringify({...f.coin,research:true}));
  f.sql.prepare("INSERT INTO research_runs VALUES('source','coin','Mars','complete',?,?,?)").run(JSON.stringify([{title:'Mars',url:'https://science.nasa.gov/mars/',description:'Science'}]),Date.now(),Date.now());
  globalThis.fetch=async(url,init)=>{if(String(url).endsWith('/healthz'))return new Response('{}');if(String(url).endsWith('/capture')){captures++;assert.equal(JSON.parse(init.body).url,'https://science.nasa.gov/mars/');return Response.json({url:'https://science.nasa.gov/mars/',title:'Mars science',text:'A page excerpt actually retrieved by the browser.',frames:[{base64:'/9j/2Q==',scrollY:0}]});}return fetchBefore(url,init)};
  f.modifyReply((reply,guard)=>{if(!guard&&step++===0)reply.choices[0].message.content=JSON.stringify({tool:'browse',url:'https://science.nasa.gov/mars/'});return reply;});
  assert.equal((await runAgentTick(['autonomous-planning'])).reason,'plan_completed');assert.equal(captures,1);assert.match(JSON.parse(f.calls[1].messages[1].content).browserResults[0].text,/actually retrieved/);
  assert.equal(f.sql.prepare('SELECT status FROM browser_sessions').get().status,'complete');assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM browser_frames').get().n,1);
  f.due();f.output({tool:'browse',url:'http://127.0.0.1/'});assert.equal((await runAgentTick(['autonomous-planning'])).reason,'plan_rejected');assert.equal(captures,1);
 }finally{delete env.BROWSER_URL;delete env.BROWSER_TOKEN;delete env.BRAVE_API_KEY;delete env.BRAVE_COST_MICROUSD;f.close();}
});

for(const mode of ['ready','unavailable','capture_failed','rejected'])test(`search source preview: ${mode}`,async()=>{
 const f=fixture(),fetchBefore=globalThis.fetch;let step=0,captures=0;
 Object.assign(env,{BROWSER_URL:'http://browser:8090',BROWSER_TOKEN:'test-browser-token-'.repeat(4),BRAVE_API_KEY:'test',BRAVE_COST_MICROUSD:'5000'});
 globalThis.__plannerResearch=async()=>[{title:'Mars',url:'https://science.nasa.gov/mars/',description:'Science snippet'}];
 try{
  f.sql.prepare('UPDATE coins SET config=?').run(JSON.stringify({...f.coin,research:true}));
  globalThis.fetch=async(url,init)=>{
   if(String(url).endsWith('/healthz'))return new Response('{}',{status:mode==='unavailable'?503:200});
   if(String(url).endsWith('/capture')){captures++;assert.equal(JSON.parse(init.body).url,'https://science.nasa.gov/mars/');return mode==='capture_failed'?new Response('{}',{status:502}):Response.json({url:'https://science.nasa.gov/mars/',title:'Mars',text:'Actual page excerpt',frames:[{base64:'/9j/2Q==',scrollY:0}]});}
   return fetchBefore(url,init);
  };
  f.modifyReply((reply,guard)=>{if(!guard&&step++<2)reply.choices[0].message.content=JSON.stringify({tool:'research',query:'Mars science'});return reply;});
  if(mode==='rejected')f.reject();
  assert.equal((await runAgentTick(['autonomous-planning'])).reason,mode==='rejected'?'plan_rejected':'plan_completed');
  assert.equal(captures,mode==='unavailable'?0:1,'at most one automatic capture across both search steps');
  const context=JSON.parse(f.calls[1].messages[1].content);
  if(mode==='unavailable')assert.deepEqual(context.browserResults,[]);
  else{
   assert.equal(context.browserResults[0].status,mode==='capture_failed'?'unavailable':'complete');
   assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM browser_frames').get().n,mode==='capture_failed'?0:1);
  }
 }finally{for(const key of ['BROWSER_URL','BROWSER_TOKEN','BRAVE_API_KEY','BRAVE_COST_MICROUSD'])delete env[key];delete globalThis.__plannerResearch;f.close();}
});

test('browser readiness distinguishes missing setup, unhealthy service and a successful probe',async()=>{
 const {browserStatus}=await import('../lib/browser-research.ts');
 try{
  assert.equal(await browserStatus(),'not_configured');env.BROWSER_URL='http://browser:8090';env.BROWSER_TOKEN='test-browser-token-'.repeat(4);
  globalThis.fetch=async()=>new Response('{}',{status:503});assert.equal(await browserStatus(),'unavailable');
  globalThis.fetch=async()=>{throw Error('offline')};assert.equal(await browserStatus(),'unavailable');
  globalThis.fetch=async()=>new Response('{}');assert.equal(await browserStatus(),'ready');
 }finally{delete env.BROWSER_URL;delete env.BROWSER_TOKEN;globalThis.fetch=originalFetch;}
});

test('task ownership and the three-active-task limit are enforced independently of the model',async()=>{
 const f=fixture();try{
  const {validateTask}=await import('../lib/agent-work.ts');
  for(let i=0;i<3;i++)f.sql.prepare("INSERT INTO agent_tasks VALUES(?,'coin','A goal','Next step','active',NULL,?,?)").run('task'+i,Date.now(),Date.now());
  await assert.rejects(validateTask('coin',task),/limit/);await assert.rejects(validateTask('another',{...task,id:'task0'}),/belong/);
  f.sql.prepare("INSERT INTO agent_operations(id,coin_id,kind,amount_wei,status,expires_at,created_at,reason) VALUES('reward','coin','rewards','10','queued',?,?, 'Pending reward')").run(Date.now()+100000,Date.now());
  const finished={...task,id:'task0',status:'complete',evidence:{kind:'treasury',id:'reward'}};
  await assert.rejects(validateTask('coin',finished),/not confirmed/);
  f.sql.prepare("UPDATE agent_operations SET status='confirmed'").run();await validateTask('coin',finished);
 }finally{f.close();}
});

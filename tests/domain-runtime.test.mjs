import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createDatabase,migratePostgres} from '../server/postgres.mjs';
import {resolve} from 'node:path';
register('./runtime-loader.mjs',import.meta.url);
const env=globalThis.__shenTestEnv={HOSTING_IPV4:'8.8.4.4'};
const {runDomainTick,domainOrderStatement,domainSnapshot}=await import('../lib/domain-runtime.ts');
const {DomainProviderError}=await import('../lib/domain-provider.ts');
const {HostingError}=await import('../lib/domain-hosting.ts');
const id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',coinId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const proposal={domain:'curiousmind.xyz',kind:'register',maxCostCents:1200,maxAnnualRenewalCents:1500,maxBnbWei:'50000000000000000',reason:'A memorable home for the community.'};
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8'));
 function prepare(query,values=[]){return {bind(...v){return prepare(query,v)},async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}}},async first(){return sql.prepare(query).get(...values)??null},async all(){return {results:sql.prepare(query).all(...values)}}}};
 env.DB={prepare,async batch(stmts){sql.exec('BEGIN');try{const r=[];for(const s of stmts)r.push(await s.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};
 const now=Date.now();sql.prepare('INSERT INTO coins(id,owner,config,token_address,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(coinId,'owner',JSON.stringify({id:coinId,name:'Mind',lastPlanRunId:id}),'0xabc','now','now');
 sql.prepare('INSERT INTO runtime_leases(coin_id,lease_id,lease_until) VALUES(?,?,?)').run(coinId,'lease',now+600000);
 sql.prepare('INSERT INTO site_revisions(id,coin_id,revision,content,published_at) VALUES(?,?,1,?,?)').run('site',coinId,'{}',now);
 const calls=[];let purchaseError=null,deployError=false,siteLive=true,expiry=now+365*86400000,credit=true,quotedCost=1000;
 const deps={registrar:{check:async()=>({available:true,premium:false,annualRenewalCents:1200}),quote:async()=>({costCents:quotedCost,withinMonthlySpendLimit:true}),balance:async()=>({balanceCents:2000}),cryptoTopupStatus:async()=>({credited:credit,state:credit?'COMPLETED':'PROCESSING'}),purchase:async input=>{calls.push(['purchase',input]);if(purchaseError)throw purchaseError;return {costCents:quotedCost,orderId:1}},detail:async()=>({status:'ACTIVE',createdAt:now,expiresAt:expiry,apiAccess:true}),setAutoRenewOff:async()=>{calls.push(['autorenewOff'])},ensureDns:async()=>{calls.push(['dns'])}},host:{ensureRoute:async(_d,options)=>{calls.push(['route',options]);return {domainId:'route'}},queueDeployment:async()=>{calls.push(['deploy']);if(deployError)throw Error('Lost deployment response');return {queued:true}},verifySite:async()=>({live:siteLive})},funding:async()=>({id,coinId,amountCents:1022,credited:true,creditedMicrousd:10110000,checkoutId:'checkout123'})};
 return {sql,deps,calls,async queue(p=proposal){await domainOrderStatement({coinId,id:'lease'},id,p,Date.now()).run()},row(){return sql.prepare('SELECT * FROM domain_orders WHERE id=?').get(id)},async tick(){sql.prepare('UPDATE domain_orders SET next_attempt_at=0').run();return runDomainTick(deps)},purchaseError(e){purchaseError=e},deployError(){deployError=true},siteLive(v){siteLive=v},expiry(v){expiry=v},credit(v){credit=v},price(v){quotedCost=v},close(){sql.close()}};
}
test('domain purchase is funded once, charged once, hosted and verified before live',async()=>{
 const f=fixture();try{
  await f.queue();await f.tick();assert.equal(f.row().funding_cents,1022);assert.equal(f.row().status,'funding');
  await f.tick();assert.equal(f.row().credit_cents,1011);await f.tick();assert.equal(f.row().reserved_cents,1000);
  await f.tick();assert.equal(f.row().charged_cents,1000);assert.equal(f.row().reserved_cents,0);assert.equal(f.calls.filter(c=>c[0]==='purchase').length,1);
  await f.tick();assert.equal(f.sql.prepare('SELECT state FROM coin_domains').get().state,'provisioning');
  await f.tick();await f.tick();await f.tick();f.siteLive(false);await f.tick();assert.equal(f.row().status,'verify');
  f.siteLive(true);await f.tick();assert.equal(f.row().status,'live');assert.equal(f.sql.prepare('SELECT state FROM coin_domains').get().state,'live');
  assert.equal((await domainSnapshot(coinId,false)).registrarCreditCents,11);assert.equal(f.calls.filter(c=>c[0]==='deploy').length,1);
 }finally{f.close()}
});
test('registrar credit must independently confirm before coin receives it',async()=>{
 const f=fixture();try{await f.queue();await f.tick();f.credit(false);await f.tick();assert.equal(f.row().status,'funding');assert.equal(f.row().credit_cents,0);assert.equal(f.calls.length,0)}finally{f.close()}
});
test('ambiguous purchase reuses its key and reservation; replay expiry requires reconciliation',async()=>{
 const f=fixture();try{
  await f.queue();await f.tick();await f.tick();await f.tick();f.purchaseError(new DomainProviderError('REGISTRAR_TRANSPORT',true));await f.tick();const first=f.calls[0][1];assert.equal(f.row().reserved_cents,1000);await f.tick();assert.equal(f.calls[1][1].idempotencyKey,first.idempotencyKey);assert.equal(f.calls[1][1].startedAt,first.startedAt);assert.equal(f.calls[1][1].previouslyAttempted,true);
  f.purchaseError(new DomainProviderError('IDEMPOTENCY_WINDOW_EXPIRED',true));await f.tick();assert.equal(f.row().status,'review');assert.equal(f.row().reserved_cents,1000);const n=f.calls.length;await f.tick();assert.equal(f.calls.length,n);
 }finally{f.close()}
});
test('explicit first-call rejection releases reservation but keeps the coin credit',async()=>{
 const f=fixture();try{await f.queue();await f.tick();await f.tick();await f.tick();f.purchaseError(new DomainProviderError('COST_MISMATCH'));await f.tick();assert.equal(f.row().status,'failed');assert.equal(f.row().reserved_cents,0);assert.equal(f.row().charged_cents,0);assert.equal(f.row().credit_cents,1011)}finally{f.close()}
});
test('another coin cannot spend shared registrar credit and a changed price cannot exceed budget',async()=>{
 const f=fixture();try{await f.queue();await f.tick();f.sql.prepare("UPDATE domain_orders SET status='reserve'").run();await f.tick();assert.equal(f.row().status,'reserve');assert.equal(f.row().reserved_cents,0);f.price(1300);await f.tick();assert.equal(f.row().status,'failed');assert.equal(f.calls.length,0)}finally{f.close()}
});
test('a lost Dokploy reply is probed without a second deployment',async()=>{
 const f=fixture();try{await f.queue();for(let i=0;i<7;i++)await f.tick();assert.equal(f.row().status,'deploy');f.deployError();await f.tick();assert.equal(f.row().deploy_attempted,1);await f.tick();await f.tick();assert.equal(f.row().status,'live');assert.equal(f.calls.filter(c=>c[0]==='deploy').length,1)}finally{f.close()}
});
test('expired agent lease and absence of a site prevent domain orders',async()=>{
 const f=fixture();try{f.sql.prepare('UPDATE runtime_leases SET lease_until=0').run();await f.queue();assert.equal(f.row(),undefined);f.sql.prepare('UPDATE runtime_leases SET lease_until=?').run(Date.now()+60000);f.sql.prepare('DELETE FROM site_revisions').run();await f.queue();assert.equal(f.row(),undefined)}finally{f.close()}
});
test('renewal waits for extended registry expiry and does not rewrite DNS',async()=>{
 const f=fixture();try{
  // Existing registration is close enough to expiry for a fresh agent renewal.
  const old=Date.now()+10*86400000;await f.queue();f.sql.prepare("UPDATE domain_orders SET status='live'").run();f.sql.prepare('INSERT INTO coin_domains(coin_id,domain,state,verification_token,expires_at,order_id,updated_at) VALUES(?,?,?,?,?,?,?)').run(coinId,proposal.domain,'live','v'.repeat(32),old,id,Date.now());
  f.sql.prepare("UPDATE domain_orders SET kind='renew',payload=?,status='owned',charged_cents=1000,purchase_started_at=?").run(JSON.stringify({...proposal,kind:'renew'}),Date.now());f.expiry(old);await f.tick();assert.equal(f.row().status,'owned');f.expiry(old+365*86400000);await f.tick();assert.equal(f.row().status,'verify');await f.tick();assert.equal(f.row().status,'live');assert.equal(f.calls.some(c=>c[0]==='dns'),false);
 }finally{f.close()}
});
test('domain order, credit reservation and publication work on PostgreSQL',async()=>{
 const f=fixture(),pg=new PGlite();await pg.waitReady;
 try{
  await migratePostgres({query:(q,p)=>p?pg.query(q,p):pg.exec(q).then(r=>r[0]??{rows:[]})},resolve('drizzle'));
  for(const table of ['coins','runtime_leases','site_revisions'])for(const row of f.sql.prepare('SELECT * FROM '+table).all()){const keys=Object.keys(row);await pg.query(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));}
  let tail=Promise.resolve();env.DB=createDatabase({async connect(){const prior=tail;let release;tail=new Promise(r=>{release=r});await prior;return {async query(q,p){const r=await pg.query(q,p);return {...r,rowCount:r.affectedRows??r.rows.length}},release}}});
  await domainOrderStatement({coinId,id:'lease'},id,proposal,Date.now()).run();
  for(let i=0;i<9;i++){await pg.query('UPDATE domain_orders SET next_attempt_at=0');await runDomainTick(f.deps)}
  assert.equal((await pg.query('SELECT status,charged_cents,credit_cents FROM domain_orders')).rows[0].status,'live');assert.equal(Number((await pg.query('SELECT charged_cents FROM domain_orders')).rows[0].charged_cents),1000);
 }finally{await pg.close();f.close()}
});

test('shared registrar balance must cover every coin liability before a reservation',async()=>{
 const f=fixture();try{
  await f.queue();await f.tick();await f.tick();
  f.sql.prepare('INSERT INTO coins(id,owner,config,created_at,updated_at) VALUES(?,?,?,?,?)').run('other','owner','{}','now','now');
  f.sql.prepare("INSERT INTO domain_orders(id,coin_id,domain,kind,payload,status,credit_cents,created_at,updated_at) VALUES('other','other','other.xyz','register','{}','failed',1500,0,0)").run();
  await f.tick();assert.equal(f.row().status,'reserve');assert.equal(f.row().reserved_cents,0,'2000 account balance cannot back 2511 of total coin credit');
  f.deps.registrar.balance=async()=>({balanceCents:3000});await f.tick();assert.equal(f.row().status,'purchase');assert.equal(f.row().reserved_cents,1000);
 }finally{f.close()}
});
test('known unfunded failure releases the agent while ambiguous funding holds for review',async()=>{
 const f=fixture();try{await f.queue();await f.tick();f.deps.funding=async()=>({id,coinId,amountCents:1022,credited:false,status:'failed'});await f.tick();assert.equal(f.row().status,'failed');assert.equal(f.row().charged_cents,0)}finally{f.close()}
 const g=fixture();try{await g.queue();await g.tick();g.deps.funding=async()=>({id,coinId,amountCents:1022,credited:false,status:'needs_reconciliation'});await g.tick();assert.equal(g.row().status,'review')}finally{g.close()}
});
test('hosting read failures before a POST can retry, earlier mutation ambiguity cannot',async()=>{
 const f=fixture();try{await f.queue();for(let i=0;i<6;i++)await f.tick();assert.equal(f.row().status,'route');f.deps.host.ensureRoute=async()=>{throw new HostingError('read','temporary',false)};await f.tick();assert.equal(f.row().route_attempted,0);
  f.sql.prepare('UPDATE domain_orders SET route_attempted=1').run();await f.tick();assert.equal(f.row().route_attempted,1,'a later read error cannot erase earlier mutation uncertainty');
  f.sql.prepare("UPDATE domain_orders SET status='deploy',deploy_attempted=0").run();f.deps.host.queueDeployment=async()=>{throw new HostingError('read','temporary',false)};await f.tick();assert.equal(f.row().deploy_attempted,0);
 }finally{f.close()}
});

test('lost database acknowledgement after booking a purchase cannot restore its old reservation',async()=>{
 const f=fixture();try{
  await f.queue();await f.tick();await f.tick();await f.tick();
  const original=env.DB.prepare;let once=true;
  env.DB.prepare=query=>{const statement=original(query);if(!query.includes('SET provider_order='))return statement;return {bind(...values){const bound=statement.bind(...values);return {...bound,async run(){const result=await bound.run();if(once){once=false;throw Error('Commit acknowledgement lost');}return result}}}}};
  await f.tick();assert.equal(f.row().status,'owned');assert.equal(f.row().charged_cents,1000);assert.equal(f.row().reserved_cents,0);assert.equal(f.calls.filter(c=>c[0]==='purchase').length,1);
 }finally{f.close()}
});

test('a domain taken before purchase leaves its funded credit available for another name',async()=>{
 const f=fixture();try{await f.queue();await f.tick();await f.tick();f.deps.registrar.quote=async()=>{throw new DomainProviderError('DOMAIN_NOT_AVAILABLE')};await f.tick();assert.equal(f.row().status,'failed');assert.equal(f.row().credit_cents,1011);assert.equal(f.row().charged_cents,0);assert.equal(f.row().reserved_cents,0)}finally{f.close()}
});

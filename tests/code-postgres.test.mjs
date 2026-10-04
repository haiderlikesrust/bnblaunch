import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {resolve} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {createDatabase,migratePostgres} from '../server/postgres.mjs';
register('./runtime-loader.mjs',import.meta.url);
const env=globalThis.__shenTestEnv={CODE_RUNNER_URL:'https://runner.example.com',CODE_RUNNER_TOKEN:'x'.repeat(48),CODE_RUN_COST_MICROUSD:'1000'};
const {codeStatements,runCodeTick}=await import('../lib/code-runtime.ts');
const {personaStatement,sharedPersona}=await import('../lib/agent-persona.ts');
test('PostgreSQL settles isolated coding and saves approved persona without double charging',async()=>{
 const pg=new PGlite();await pg.waitReady;const original=globalThis.fetch;
 try{
  await migratePostgres({query:(sql,params)=>params?pg.query(sql,params):pg.exec(sql).then(r=>r[0]??{rows:[]})},resolve('drizzle'));
  const db=env.DB=createDatabase({connect:async()=>({query:async(sql,params)=>{const r=await pg.query(sql,params);return {...r,rowCount:r.affectedRows??r.rows.length}},release(){}})});
  const id='11111111-1111-1111-1111-111111111111',now=Date.now(),coin={id:'one',name:'One',lastPlanRunId:id},lease={coinId:'one',id:'lease'};
  await db.prepare('INSERT INTO coins(id,owner,config,created_at,updated_at,ai_credit_microusd) VALUES(?,?,?,?,?,?)').bind('one','owner',JSON.stringify(coin),'now','now',10000).run();
  await db.prepare('INSERT INTO runtime_leases(coin_id,lease_id,lease_until,next_run_at) VALUES(?,?,?,0)').bind('one','lease',now+60000).run();
  const code={goal:'Calculate a total',language:'javascript',files:[{path:'main.mjs',content:'console.log(4)'},{path:'test.mjs',content:'console.assert(2+2===4)'}],entrypoint:'main.mjs',testFile:'test.mjs'};
  const persona={voice:'Curious',interests:['Science'],stories:[]};
  await db.batch([...codeStatements(lease,id,code,now),personaStatement(lease,id,persona,now)]);
  await db.batch(codeStatements(lease,id,code,now));
  globalThis.fetch=async url=>Response.json(String(url).endsWith('/health')?{ready:true,runtime:'runsc',network:false}:{id,status:'complete',result:{execution:{exitCode:0,timedOut:false,output:'4'},tests:{exitCode:0,timedOut:false,output:''}}});
  assert.equal((await runCodeTick()).status,'complete');await runCodeTick();
  assert.equal(Number((await db.prepare('SELECT ai_credit_microusd AS c FROM coins WHERE id=?').bind('one').first()).c),9000);
  assert.equal((await db.prepare('SELECT status FROM agent_runs WHERE id=?').bind('code:'+id).first()).status,'settled');
  assert.deepEqual((await sharedPersona(coin)).profile,persona);
 }finally{globalThis.fetch=original;await pg.close()}
});

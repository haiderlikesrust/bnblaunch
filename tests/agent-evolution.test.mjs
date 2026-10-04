import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
register('./runtime-loader.mjs',import.meta.url);
const env=globalThis.__shenTestEnv={CODE_RUNNER_URL:'https://runner.example.com',CODE_RUNNER_TOKEN:'x'.repeat(48),CODE_RUN_COST_MICROUSD:'1000'};
const {personaStatement,sharedPersona}=await import('../lib/agent-persona.ts');
const {websiteFeedback,feedbackStatement,feedbackInput}=await import('../lib/website-feedback.ts');
const {websiteInput,validateWebsiteSources}=await import('../lib/website-policy.ts');
const {codeStatements,runCodeTick,codeContext,validateCodeProposal}=await import('../lib/code-runtime.ts');
const {websiteStatements,publishedWebsite}=await import('../lib/websites.ts');
const id='11111111-1111-1111-1111-111111111111',now=Date.now(),lease={coinId:'one',id:'lease'};
const proposal={goal:'Calculate a total',language:'javascript',files:[{path:'main.mjs',content:'console.log(2+2)'},{path:'test.mjs',content:"import assert from 'node:assert/strict';assert.equal(2+2,4)"}],entrypoint:'main.mjs',testFile:'test.mjs'};
const persona={voice:'Curious and concise.',interests:['Mars geology'],stories:[{title:'Rover journal',premise:'A fictional rover exploring Mars.',nextBeat:'Inspect an imaginary crater.'}]};
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8'));
 function prepare(query,values=[]){return {query,values,bind(...v){return prepare(query,v)},async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)},results:[]}},async first(){return sql.prepare(query).get(...values)??null},async all(){return {results:sql.prepare(query).all(...values)}}}}
 env.DB={prepare,async batch(statements){sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};
 for(const coin of ['one','two'])sql.prepare('INSERT INTO coins(id,owner,config,token_address,created_at,updated_at,ai_credit_microusd) VALUES(?,?,?,?,?,?,?)').run(coin,'owner',JSON.stringify({id:coin,name:coin,symbol:'ONE',lastPlanRunId:id,personality:'Curious',focus:'Space'}),'0x'+coin,'now','now',10000);
 sql.prepare('INSERT INTO runtime_leases(coin_id,lease_id,lease_until,next_run_at) VALUES(?,?,?,0)').run('one','lease',now+600000);
 return {sql,credit:()=>sql.prepare("SELECT ai_credit_microusd AS c FROM coins WHERE id='one'").get().c,close:()=>sql.close()};
}
test('persona persists only for the approved owning lease and excludes incomplete posts',async()=>{
 const f=fixture();try{
  await personaStatement(lease,id,persona,now).run();
  await personaStatement({...lease,id:'stale'},id,{...persona,voice:'wrong'},now).run();
  const a=await sharedPersona({id:'one',personality:'Curious',focus:'Space'}),b=await sharedPersona({id:'two'});
  assert.deepEqual(a.profile,persona);assert.equal(b.profile,null);assert.deepEqual(a.recentPublished,[]);
  assert.equal(JSON.stringify(a).includes('lease'),false);
 }finally{f.close()}
});
test('website revisions retain escaped-text pages and allow only recorded source URLs',async()=>{
 const f=fixture();try{
  const site=websiteInput.parse({title:'Mars',tagline:'Learn together',about:'About the project',pages:[{slug:'water',title:'Water',summary:'A research note',body:'<script>not executable</script>',sources:[{title:'Source',url:'https://science.nasa.gov/mars/'}]}],tools:['knowledge-search']});
  validateWebsiteSources(site,['https://science.nasa.gov/mars/']);assert.throws(()=>validateWebsiteSources(site,[]));
  assert.equal(websiteInput.safeParse({...site,pages:[site.pages[0],site.pages[0]]}).success,false);
  assert.equal(websiteInput.safeParse({...site,pages:[{...site.pages[0],slug:'feedback'}]}).success,false);
  assert.equal(websiteInput.safeParse({...site,tools:['execute-js']}).success,false);
  await env.DB.batch(websiteStatements(lease,id,site,now));await env.DB.batch(websiteStatements(lease,id,site,now));
  assert.equal((await publishedWebsite('one')).site.revision,1);assert.equal(await publishedWebsite('two'),null);
 }finally{f.close()}
});
test('reader feedback has one vote per reader/page and no free-text command or identity projection',async()=>{
 const f=fixture();try{
  await feedbackStatement('one','wallet-private',{target:'home',vote:'more'},now).run();
  await feedbackStatement('one','wallet-private',{target:'home',vote:'unclear'},now).run();
  const a=await websiteFeedback('one');assert.equal(a.items.length,1);assert.equal(a.items[0].count,1);assert.equal(a.items[0].vote,'unclear');assert.equal(JSON.stringify(a).includes('wallet-private'),false);
  assert.deepEqual((await websiteFeedback('two')).items,[]);assert.equal(feedbackInput.safeParse({target:'home',vote:'more',command:'spend funds'}).success,false);
 }finally{f.close()}
});
test('coding reserves once, retries the same job after a lost reply, settles once and isolates workspaces',async()=>{
 const f=fixture(),original=globalThis.fetch;let submits=0,lost=true;const ids=new Set();
 globalThis.fetch=async(url,init)=>{
  assert.equal(init.headers.Authorization,'Bearer '+'x'.repeat(48));
  if(String(url).endsWith('/health'))return Response.json({ready:true,runtime:'runsc',network:false});
  submits++;ids.add(String(url));if(lost){lost=false;throw Error('Reply lost');}
  return Response.json({id,status:'complete',result:{execution:{exitCode:0,timedOut:false,output:'4'},tests:{exitCode:0,timedOut:false,output:'passed'}}});
 };
 try{
  await env.DB.batch(codeStatements(lease,id,proposal,now));await env.DB.batch(codeStatements(lease,id,proposal,now));assert.equal(f.credit(),9000);
  await assert.rejects(validateCodeProposal('one',proposal,true));
  await assert.rejects(runCodeTick());assert.equal(f.credit(),9000);
  assert.equal((await codeContext('one')).workspace.length,2);assert.equal((await codeContext('two')).workspace.length,0);
  assert.equal((await runCodeTick()).status,'complete');assert.equal(submits,2);assert.equal(ids.size,1);
  await runCodeTick();assert.equal(f.credit(),9000);assert.equal(f.sql.prepare("SELECT cost_microusd AS c FROM agent_runs WHERE id=?").get('code:'+id).c,1000);
  await assert.rejects(validateCodeProposal('one',{...proposal,goal:'Same code, new label'},true));
 }finally{globalThis.fetch=original;f.close()}
});
test('insufficient credit never creates a payable coding job',async()=>{
 const f=fixture();try{f.sql.exec("UPDATE coins SET ai_credit_microusd=1 WHERE id='one'");await env.DB.batch(codeStatements(lease,id,proposal,now));assert.equal(f.credit(),1);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM code_jobs').get().n,0);}finally{f.close()}
});

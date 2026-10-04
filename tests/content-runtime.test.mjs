import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { sealServiceSecret } from '../shared/service-secrets.mjs';
register('./runtime-loader.mjs',import.meta.url);
const env=globalThis.__shenTestEnv={OPENROUTER_API_KEY:'test-only-key',X_CLIENT_ID:'test-client',X_CLIENT_SECRET:'test-secret',X_API_BEARER_TOKEN:'test-billing',X_UPLOAD_COST_MICROUSD:'5000',SERVICE_CREDENTIALS_KEY:randomBytes(32).toString('hex'),X_LOGIN_DAILY_LIMIT_MICROUSD:'1000000'};
const {runContentTick}=await import('../lib/content-runtime.ts');
const originalFetch=globalThis.fetch;
const json=v=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}});
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const name of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+name,'utf8'));
 function prepare(query,values=[]){const statement={query,values,bind(...next){return prepare(query,next)},async run(){const r=sql.prepare(query).run(...values);return {meta:{changes:Number(r.changes)},results:[]}},async all(){return {results:sql.prepare(query).all(...values)}},async first(column){const r=sql.prepare(query).get(...values);return column?r?.[column]??null:r??null}};return statement;}
 env.DB={prepare,async batch(statements){sql.exec('BEGIN');try{const output=[];for(const s of statements)output.push(await s.run());sql.exec('COMMIT');return output}catch(e){sql.exec('ROLLBACK');throw e}}};
 let generations=0,posts=0,uploads=0,postText='',postMedia=null,postAt=0,missingCost=false,losePost=false,readAuthor='123';
 globalThis.fetch=async(url,init={})=>{
  const u=String(url);
  if(u.includes('/images/models/'))return json({endpoints:[{provider_tag:'seed',supported_parameters:{resolution:{values:['1K','2K']},aspect_ratio:{values:['1:1']}},pricing:[{billable:'output_image',unit:'image',cost_usd:.04}]}]});
  if(u.endsWith('/v1/images')){generations++;return json({data:[{b64_json:readFileSync('public/shen-symbol.png').toString('base64'),media_type:'image/png'}],...(missingCost?{}:{usage:{cost:.04}})});}
  if(u.endsWith('/2/usage/credits'))return json({data:{total_balance:100}});
  if(u.endsWith('/2/media/upload')){uploads++;return json({data:{id:'777'}});}
  if(u.endsWith('/2/tweets')){posts++;const v=JSON.parse(init.body);postText=v.text;postMedia=v.media?.media_ids?.[0];postAt=Date.now();if(losePost)throw Error('Lost reply after acceptance');return json({data:{id:'888'}});}
  if(u.includes('/2/users/123/tweets?'))return json({data:[{id:'888',author_id:readAuthor,text:postText,created_at:new Date(postAt).toISOString(),...(postMedia?{attachments:{media_keys:['3_'+postMedia]}}:{})}]});
  throw Error('Unexpected external call '+u);
 };
 const coin=(id,credit=1000000)=>{const config={id,name:'Community',symbol:'SHEN',social:true,images:true,language:'en',tokenAddress:'0x1111111111111111111111111111111111111111'};sql.prepare('INSERT INTO coins(id,owner,config,token_address,created_at,updated_at,ai_credit_microusd) VALUES(?,?,?,?,?,?,?)').run(id,'owner',JSON.stringify(config),config.tokenAddress+id,new Date().toISOString(),new Date().toISOString(),credit);return config;};
 const job=(id,coinId,destination='x',image=true)=>sql.prepare("INSERT INTO content_jobs(id,coin_id,payload,status,created_at,updated_at,x_provider) VALUES(?,?,?,'queued',?,?,'official')").run(id,coinId,JSON.stringify({destination,text:'A verified community update.',imagePrompt:image?'Original abstract community artwork.':null,altText:'Community illustration'}),Date.now(),Date.now());
 const account=async id=>sql.prepare("INSERT INTO x_accounts(coin_id,user_id,username,encrypted_session,version,updated_at,auth_type) VALUES(?,?,?,?,?,?,'oauth2')").run(id,'123','shen',await sealServiceSecret(env.SERVICE_CREDENTIALS_KEY,id+':123:v1',{accessToken:'test-access',refreshToken:'test-refresh',expiresAt:Date.now()+3600000,scopes:[]}),'v1',Date.now());
 return {sql,coin,job,account,get counts(){return {generations,posts,uploads}},missingCost(){missingCost=true},losePost(){losePost=true},wrongAuthor(){readAuthor='999'},close(){sql.close();globalThis.fetch=originalFetch}};
}
test('content pipeline reserves once, generates once, persists media, posts once and settles exact known cost',async()=>{
 const f=fixture();try{f.coin('coin');await f.account('coin');f.job('job','coin');await Promise.all([runContentTick(),runContentTick()]);
  for(let i=0;i<5;i++)await runContentTick();
  assert.deepEqual(f.counts,{generations:1,uploads:1,posts:1});assert.equal(f.sql.prepare('SELECT status FROM content_jobs').get().status,'complete');assert.equal(f.sql.prepare('SELECT ai_credit_microusd AS credit FROM coins').get().credit,940000);assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM content_assets').get().count,1);
 }finally{f.close()}
});
test('lost X acknowledgement is reconciled by exact account and content without a second POST',async()=>{
 const f=fixture();try{f.coin('coin');await f.account('coin');f.job('job','coin');f.losePost();for(let i=0;i<4;i++)await runContentTick();
  assert.equal(f.sql.prepare('SELECT status FROM content_jobs').get().status,'uncertain');f.sql.prepare('UPDATE content_jobs SET updated_at=?,next_attempt_at=0').run(Date.now()-61000);await runContentTick();
  assert.equal(f.sql.prepare('SELECT status FROM content_jobs').get().status,'complete');assert.equal(f.counts.posts,1);assert.equal(f.sql.prepare('SELECT ai_credit_microusd AS credit FROM coins').get().credit,935000);
 }finally{f.close()}
});
test('unknown image cost holds the reservation and never regenerates or publishes',async()=>{
 const f=fixture();try{f.coin('coin');f.job('job','coin','gallery');f.missingCost();for(let i=0;i<5;i++)await runContentTick();assert.deepEqual(f.counts,{generations:1,uploads:0,posts:0});assert.equal(f.sql.prepare('SELECT status FROM content_jobs').get().status,'uncertain');assert.equal(f.sql.prepare('SELECT status FROM agent_runs').get().status,'reserved');}finally{f.close()}
});

test('a confirmed image rejection publishes gallery text once and releases unused credit',async()=>{
 const f=fixture();try{
  f.coin('coin');f.job('job','coin','gallery');const provider=globalThis.fetch;let images=0;
  globalThis.fetch=async(url,init)=>{if(String(url).endsWith('/v1/images')){images++;assert.equal(JSON.parse(init.body).resolution,'2K');return new Response('invalid request',{status:400});}return provider(url,init);};
  for(let i=0;i<5;i++)await runContentTick();
  const job=f.sql.prepare('SELECT * FROM content_jobs').get();assert.equal(job.status,'complete');assert.equal(JSON.parse(job.payload).imagePrompt,null);assert.equal(JSON.parse(job.payload).text,'A verified community update.');
  assert.equal(images,1);assert.equal(f.sql.prepare('SELECT ai_credit_microusd credit FROM coins').get().credit,1000000);assert.equal(f.sql.prepare('SELECT status FROM agent_runs').get().status,'settled');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM events').get().n,1);assert.match(f.sql.prepare('SELECT message FROM events').get().message,/without artwork/);
 }finally{f.close();}
});
test('a coin without credit does not starve another gallery job; gallery settlement survives restart',async()=>{
 const f=fixture();try{f.coin('poor',0);f.coin('funded');f.job('a','poor','gallery');f.job('b','funded','gallery');await runContentTick();await runContentTick();await runContentTick();f.sql.exec("UPDATE content_jobs SET status='media_ready',next_attempt_at=0 WHERE id='b'");await runContentTick();assert.equal(f.sql.prepare("SELECT status FROM content_jobs WHERE id='b'").get().status,'complete');assert.equal(f.counts.generations,1);assert.equal(f.counts.posts,0);}finally{f.close()}
});
test('stale expiry cannot refund a competing active X post',{timeout:5000},async()=>{
 const f=fixture(),realNow=Date.now;
 const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
 const firstHeld=deferred(),releaseFirst=deferred(),postStarted=deferred(),releasePost=deferred();let a,b;
 try{
  f.coin('coin');await f.account('coin');f.job('job','coin','x',false);await runContentTick();
  const initial=realNow();let now=initial;Date.now=()=>now;
  f.sql.prepare('UPDATE content_jobs SET created_at=?,next_attempt_at=0').run(initial-21480000);
  const prepare=env.DB.prepare;let held=false;
  function wrap(s){return {...s,bind(...values){return wrap(s.bind(...values))},async run(){const result=await s.run();if(!held&&s.query.startsWith('UPDATE content_jobs SET next_attempt_at=')){held=true;firstHeld.resolve();await releaseFirst.promise}return result}}}
  env.DB.prepare=(...args)=>wrap(prepare(...args));
  const providerFetch=globalThis.fetch;globalThis.fetch=async(url,init)=>{if(String(url).endsWith('/2/tweets')){postStarted.resolve();await releasePost.promise}return providerFetch(url,init)};
  a=runContentTick();await firstHeld.promise;now=initial+90001;b=runContentTick();await postStarted.promise;
  now=initial+120001;releaseFirst.resolve();await a;
  assert.equal(f.sql.prepare('SELECT status FROM content_jobs').get().status,'posting');assert.equal(f.sql.prepare('SELECT status FROM agent_runs').get().status,'reserved');assert.equal(f.sql.prepare('SELECT ai_credit_microusd credit FROM coins').get().credit,835000);
  releasePost.resolve();await b;
  assert.equal(f.counts.posts,1);assert.equal(f.sql.prepare('SELECT ai_credit_microusd credit FROM coins').get().credit,985000);assert.equal(f.sql.prepare('SELECT cost_microusd FROM agent_runs').get().cost_microusd,15000);assert.equal(f.sql.prepare('SELECT status FROM content_jobs').get().status,'complete');
 }finally{releaseFirst.resolve();releasePost.resolve();await Promise.allSettled([a,b].filter(Boolean));Date.now=realNow;f.close()}
});


test('local community text publishes without X, image services or additional provider charges',async()=>{
 const f=fixture(),keys=['X_CLIENT_ID','X_CLIENT_SECRET','X_API_BEARER_TOKEN','OPENROUTER_API_KEY','X_READ_COST_MICROUSD'],previous=Object.fromEntries(keys.map(k=>[k,env[k]]));
 try{
  for(const key of keys)delete env[key];env.X_READ_COST_MICROUSD='invalid';
  const coin=f.coin('local');f.sql.prepare('UPDATE coins SET config=? WHERE id=?').run(JSON.stringify({...coin,social:false,images:false}),'local');
  f.job('text','local','gallery',false);
  globalThis.fetch=async()=>{throw Error('A local text post must not call a provider')};
  await runContentTick();await runContentTick();await runContentTick();
  assert.equal(f.sql.prepare('SELECT status FROM content_jobs').get().status,'complete');
  assert.equal(f.sql.prepare('SELECT ai_credit_microusd AS credit FROM coins').get().credit,1000000);
  assert.equal(f.sql.prepare('SELECT status,cost_microusd FROM agent_runs').get().cost_microusd,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM events').get().n,1);
  assert.deepEqual(f.counts,{generations:0,uploads:0,posts:0});
 }finally{for(const key of keys){if(previous[key]===undefined)delete env[key];else env[key]=previous[key];}f.close();}
});

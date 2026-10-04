import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createDatabase, migratePostgres } from '../server/postgres.mjs';
import { sealServiceSecret } from '../shared/service-secrets.mjs';
register('./runtime-loader.mjs',import.meta.url);
const env=globalThis.__shenTestEnv={OPENROUTER_API_KEY:'test-only-key',X_CLIENT_ID:'test-client',X_CLIENT_SECRET:'test-secret',X_API_BEARER_TOKEN:'test-billing',X_UPLOAD_COST_MICROUSD:'5000',SERVICE_CREDENTIALS_KEY:randomBytes(32).toString('hex'),HIGGSFIELD_API_KEY_ID:'test-key-id',HIGGSFIELD_API_KEY_SECRET:'test-key-secret',HIGGSFIELD_IMAGE_COST_MICROUSD:'60000',HIGGSFIELD_VIDEO_COST_MICROUSD:'400000',HIGGSFIELD_CHARACTER_COST_MICROUSD:'500000',INFLUENCER_VIDEO_PERCENT:'100',INFLUENCER_CREDIT_FLOOR_MICROUSD:'1000000'};
const {runInfluencerTick,influencerStatus}=await import('../lib/influencer-runtime.ts');
const json=v=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}});
const CHARACTER='3f0c3a2e-7c4b-4b8e-9d6a-2a1f5e8c9b10',png=readFileSync('public/shen-symbol.png'),mp4=new Uint8Array(1000);mp4.set([0,0,0,0x18,0x66,0x74,0x79,0x70],0);

// The production database is PostgreSQL behind the D1-compatible shim.
test('the influencer lifecycle runs on PostgreSQL with exact settlement',async()=>{
 const pg=new PGlite();await pg.waitReady;const original=globalThis.fetch;let posts=0,postText='',postAt=0;
 try{
  await migratePostgres({query:(sql,params)=>params?pg.query(sql,params):pg.exec(sql).then(r=>r[0]??{rows:[]})},resolve('drizzle'));
  const db=env.DB=createDatabase({connect:async()=>({query:async(sql,params)=>{const r=await pg.query(sql,params);return {...r,rowCount:r.affectedRows??r.rows.length}},release(){}})});
  const config={enabled:true,kind:'robot',presents:null,age:null,build:null,hair:null,outfit:null,features:[],accessories:[],vibe:'chill',style:'anime',palette:[],notes:''};
  const coin={id:'coin',name:'Community',symbol:'SHEN',description:'A community token.',language:'en',purpose:'Keep the community informed.',modelId:'z-ai/glm-5.3',state:'active',social:true,influencer:config,tokenAddress:'0x1'};
  await db.prepare('INSERT INTO coins(id,owner,config,token_address,created_at,updated_at,ai_credit_microusd) VALUES(?,?,?,?,?,?,?)').bind('coin','owner',JSON.stringify(coin),'0x1',new Date().toISOString(),new Date().toISOString(),5000000).run();
  await db.prepare("INSERT INTO influencers(coin_id,config,status,created_at,updated_at) VALUES('coin',?,'pending_launch',?,?)").bind(JSON.stringify(config),Date.now(),Date.now()).run();
  await db.prepare("INSERT INTO x_accounts(coin_id,user_id,username,encrypted_session,version,updated_at,auth_type) VALUES('coin','123','shen',?,'v1',?,'oauth2')").bind(await sealServiceSecret(env.SERVICE_CREDENTIALS_KEY,'coin:123:v1',{accessToken:'a',refreshToken:'r',expiresAt:Date.now()+3600000,scopes:[]}),Date.now()).run();
  globalThis.fetch=async(url,init={})=>{
   const u=String(url),method=init.method??'GET';
   if(u==='https://openrouter.ai/api/v1/models')return json({data:['z-ai/glm-5.3','qwen/qwen3.8-max-0902'].map(id=>({id,pricing:{prompt:'0.000001',completion:'0.000002'},supported_parameters:['response_format']}))});
   if(u==='https://openrouter.ai/api/v1/chat/completions'){const system=JSON.parse(init.body).messages[0].content;return json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(system.startsWith('Independently review')?{allow:true,reason:'ok'}:{scene:'The character tunes a vintage radio in a cosy studio at night.',motion:'Gentle dolly-in.',caption:'Night shift on the community frequency.'})}}],usage:{cost:0.0005}});}
   if(u.startsWith('https://api.higgsfield.ai/')){
    const path=u.slice(25);
    if(method==='POST'&&path==='/v1/custom-references')return json({id:CHARACTER,status:'queued'});
    if(path==='/v1/custom-references/'+CHARACTER)return json({status:'completed'});
    if(method==='POST')return json({status:'queued',request_id:'req-'+(path.includes('kling')?'video':'image')+'-'+Math.random().toString(36).slice(2,10)});
    const id=path.match(/^\/requests\/(.+)\/status$/)[1];return json(id.startsWith('req-video')?{status:'completed',video:{url:'https://cdn.higgsfield.test/clip.mp4'}}:{status:'completed',images:[{url:'https://cdn.higgsfield.test/image.png'}]});
   }
   if(u==='https://cdn.higgsfield.test/image.png')return new Response(png);
   if(u==='https://cdn.higgsfield.test/clip.mp4')return new Response(mp4);
   if(u.endsWith('/2/usage/credits'))return json({data:{total_balance:100}});
   if(u.endsWith('/2/media/upload/initialize'))return json({data:{id:'555'}});
   if(u.endsWith('/2/media/upload/555/append'))return new Response(null,{status:204});
   if(u.endsWith('/2/media/upload/555/finalize'))return json({data:{id:'555'}});
   if(u.endsWith('/2/tweets')){posts++;postText=JSON.parse(init.body).text;postAt=Date.now();return json({data:{id:'888'}});}
   throw Error('Unexpected external call '+method+' '+u);
  };
  for(let i=0;i<22;i++){await pg.exec('UPDATE influencers SET next_attempt_at=0,next_post_at=0;UPDATE influencer_posts SET next_attempt_at=0');await runInfluencerTick(['influencer-media']);}
  const post=await db.prepare('SELECT status,kind,tweet_id FROM influencer_posts ORDER BY created_at LIMIT 1').first();
  assert.deepEqual(post,{status:'complete',kind:'video',tweet_id:'888'});assert.equal(posts>=1,true);assert.equal(postText,'Night shift on the community frequency.');
  const settled=await db.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE kind='influencer' AND status='settled'").first();assert.ok(Number(settled.n)>=2);
  assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE status='reserved' AND kind='influencer' AND id NOT IN (SELECT 'influencer:'||id FROM influencer_posts WHERE status NOT IN ('complete','failed'))").first()).n),0);
  const completed=await db.prepare("SELECT COUNT(*) AS n,COALESCE(SUM(cost_microusd),0) AS cost FROM influencer_posts WHERE status='complete'").first();
  const credit=(await db.prepare("SELECT ai_credit_microusd AS c FROM coins WHERE id='coin'").first()).c,held=(await db.prepare("SELECT COALESCE(SUM(reserved_microusd),0) AS r FROM agent_runs WHERE status='reserved'").first()).r;
  assert.equal(Number(credit)+Number(held),5000000-500000-Number(completed.cost),'credit, holds and settled costs reconcile exactly');
  const status=await influencerStatus({id:'coin',name:'Community',symbol:'SHEN',tokenAddress:'0x1'},false);assert.equal(status.status,'active');assert.equal(status.posts.find(p=>p.status==='complete').tweetUrl,'https://x.com/i/status/888');
 }finally{globalThis.fetch=original;await pg.close()}
});

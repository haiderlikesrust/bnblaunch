import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { sealServiceSecret } from '../shared/service-secrets.mjs';
register('./runtime-loader.mjs',import.meta.url);
const env=globalThis.__shenTestEnv={OPENROUTER_API_KEY:'test-only-key',X_CLIENT_ID:'test-client',X_CLIENT_SECRET:'test-secret',X_API_BEARER_TOKEN:'test-billing',X_UPLOAD_COST_MICROUSD:'5000',SERVICE_CREDENTIALS_KEY:randomBytes(32).toString('hex'),HIGGSFIELD_API_KEY_ID:'test-key-id',HIGGSFIELD_API_KEY_SECRET:'test-key-secret',HIGGSFIELD_IMAGE_COST_MICROUSD:'60000',HIGGSFIELD_VIDEO_COST_MICROUSD:'400000',HIGGSFIELD_CHARACTER_COST_MICROUSD:'500000',INFLUENCER_VIDEO_PERCENT:'100',INFLUENCER_CREDIT_FLOOR_MICROUSD:'1000000'};
const {runInfluencerTick,influencerStatus,influencerFunding}=await import('../lib/influencer-runtime.ts');
const originalFetch=globalThis.fetch,caps=['influencer-media'];
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
const png=readFileSync('public/shen-symbol.png'),mp4=new Uint8Array(4500000);mp4.set([0,0,0,0x18,0x66,0x74,0x79,0x70],0);
const CHARACTER='3f0c3a2e-7c4b-4b8e-9d6a-2a1f5e8c9b10';
function fixture({connected=true,startCredit=5000000}={}){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const name of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+name,'utf8'));
 function prepare(query,values=[]){const statement={query,values,bind(...next){return prepare(query,next)},async run(){const r=sql.prepare(query).run(...values);return {meta:{changes:Number(r.changes)},results:[]}},async all(){return {results:sql.prepare(query).all(...values)}},async first(column){const r=sql.prepare(query).get(...values);return column?r?.[column]??null:r??null}};return statement;}
 env.DB={prepare,async batch(statements){sql.exec('BEGIN');try{const output=[];for(const s of statements)output.push(await s.run());sql.exec('COMMIT');return output}catch(e){sql.exec('ROLLBACK');throw e}}};
 const calls={submits:[],posts:0,appends:0,imageUploads:0,videoInits:0,reads:0,characters:0},state={imageStatus:'completed',losePost:false,timeoutSubmitOnce:false,guardAllow:true,readAuthor:'123'};
 let postText='',postMedia=null,postAt=0;
 globalThis.fetch=async(url,init={})=>{
  const u=String(url),method=init.method??'GET';
  if(u==='https://openrouter.ai/api/v1/models')return json({data:['z-ai/glm-5.3','qwen/qwen3.8-max-0902'].map(id=>({id,pricing:{prompt:'0.000001',completion:'0.000002'},supported_parameters:['response_format']}))});
  if(u==='https://openrouter.ai/api/v1/chat/completions'){
   const body=JSON.parse(init.body),system=body.messages[0].content;
   const content=system.startsWith('Independently review')?{allow:state.guardAllow,reason:state.guardAllow?'ok':'declined'}:{scene:'The character waves from a neon-lit rooftop at dusk, city lights glowing behind it.',motion:'Slow push-in as the character waves.',caption:'Rooftop shift complete. The community kept the lights on today. $SHEN'};
   return json({id:'gen',choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}],usage:{cost:0.0005,prompt_tokens:100,completion_tokens:50}});
  }
  if(u.startsWith('https://api.higgsfield.ai/')){
   assert.equal(init.headers?.Authorization,'Key test-key-id:test-key-secret');
   const path=u.slice('https://api.higgsfield.ai'.length);
   if(method==='POST'&&path==='/v1/custom-references'){calls.characters++;if(state.loseCharacter)throw new TypeError("Lost creation reply");calls.trainedOn=JSON.parse(init.body).input_images.map(i=>i.image_url);return json({id:CHARACTER,status:'queued'});}
   if(method==='POST'&&path==='/files/generate-upload-url')return json({public_url:'https://cdn.higgsfield.test/reference.png',upload_url:'https://storage.higgsfield.test/put',content_type:'image/png',upload_headers:{'Content-Type':'image/png','x-amz-tagging':'retention=temporary'}});
   if(path==='/v1/custom-references/'+CHARACTER)return json({id:CHARACTER,status:'completed'});
   if(method==='POST'){
    const key=init.headers['Idempotency-Key'];calls.submits.push({path,key,body:JSON.parse(init.body)});
    if(state.timeoutSubmitOnce){state.timeoutSubmitOnce=false;throw new TypeError('socket hang up');}
    if(state.rejectVideo&&key.endsWith(':video'))return new Response('{}',{status:400});
    if(state.rejectStatus)return new Response('{}',{status:state.rejectStatus});
    return json({status:'queued',request_id:'req-'+key.replace(/[^A-Za-z0-9-]/g,'-').slice(-60)});
   }
   const request=path.match(/^\/requests\/(.+)\/status$/)?.[1];
   if(request){const video=request.endsWith('-video');return json(video?{status:'completed',request_id:request,video:{url:'https://cdn.higgsfield.test/clip.mp4'}}:{status:state.imageStatus,request_id:request,images:state.imageStatus==='completed'?[{url:'https://cdn.higgsfield.test/image.png'}]:[]});}
  }
  if(u==='https://storage.higgsfield.test/put'){assert.equal(new Headers(init.headers).get('authorization'),null,'credentials never reach storage');calls.storage=(calls.storage??0)+1;return new Response(null,{status:200});}
  if(u==='https://cdn.higgsfield.test/image.png')return new Response(png,{headers:{'Content-Type':'image/png'}});
  if(u==='https://cdn.higgsfield.test/clip.mp4')return new Response(mp4,{headers:{'Content-Type':'video/mp4'}});
  if(u.endsWith('/2/usage/credits'))return json({data:{total_balance:100}});
  if(u.endsWith('/2/media/upload/initialize')){calls.videoInits++;assert.equal(JSON.parse(init.body).media_category,'tweet_video');return json({data:{id:'555'}});}
  if(u.endsWith('/2/media/upload/555/append')){calls.appends++;return new Response(null,{status:204});}
  if(u.endsWith('/2/media/upload/555/finalize'))return json({data:{id:'555',processing_info:{state:'succeeded'}}});
  if(u.endsWith('/2/media/upload')){calls.imageUploads++;if(state.loseUpload)throw new TypeError("Lost upload reply");return json({data:{id:'777'}});}
  if(u.endsWith('/2/tweets')){calls.posts++;const v=JSON.parse(init.body);postText=v.text;postMedia=v.media?.media_ids?.[0];postAt=Date.now();if(state.losePost)throw new TypeError('Lost reply after acceptance');return json({data:{id:'888'}});}
  if(u.includes('/2/users/123/tweets?')){calls.reads++;return json({data:[{id:'888',author_id:state.readAuthor,text:postText,created_at:new Date(postAt).toISOString(),...(postMedia?{attachments:{media_keys:['7_'+postMedia]}}:{})}]});}
  throw Error('Unexpected external call '+method+' '+u);
 };
 const config={enabled:true,kind:'robot',presents:null,age:null,build:null,hair:'neon',outfit:'hoodie',features:[],accessories:['headphones'],vibe:'chill',style:'logo',palette:['#ff603e'],notes:'Talks like a late-night radio host.'};
 const coin={id:'coin',name:'Community',symbol:'SHEN',description:'A community token with a radio-host mascot.',language:'en',purpose:'Research the ecosystem and keep the community informed.',modelId:'z-ai/glm-5.3',state:'active',social:true,images:true,influencer:config,tokenAddress:'0x1111111111111111111111111111111111111111'};
 sql.prepare('INSERT INTO coins(id,owner,config,token_address,created_at,updated_at,ai_credit_microusd) VALUES(?,?,?,?,?,?,?)').run('coin','owner',JSON.stringify(coin),coin.tokenAddress,new Date().toISOString(),new Date().toISOString(),startCredit);
 sql.prepare("INSERT INTO influencers(coin_id,config,status,created_at,updated_at) VALUES('coin',?,'awaiting_x',?,?)").run(JSON.stringify(config),Date.now(),Date.now());
 const connect=async()=>sql.prepare("INSERT INTO x_accounts(coin_id,user_id,username,encrypted_session,version,updated_at,auth_type) VALUES('coin','123','shen',?,'v1',?,'oauth2')").run(await sealServiceSecret(env.SERVICE_CREDENTIALS_KEY,'coin:123:v1',{accessToken:'test-access',refreshToken:'test-refresh',expiresAt:Date.now()+3600000,scopes:[]}),Date.now());
 const drive=async(n=1)=>{for(let i=0;i<n;i++){sql.exec('UPDATE influencers SET next_attempt_at=0;UPDATE influencer_posts SET next_attempt_at=0');await runInfluencerTick(caps);}};
 const credit=()=>sql.prepare("SELECT ai_credit_microusd AS c FROM coins WHERE id='coin'").get().c;
 const influencer=()=>sql.prepare("SELECT * FROM influencers WHERE coin_id='coin'").get();
 const post=()=>sql.prepare('SELECT * FROM influencer_posts ORDER BY created_at DESC LIMIT 1').get();
 const reserved=()=>sql.prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE status='reserved'").get().n;
 return {sql,calls,state,connect:connected?connect:async()=>{},doConnect:connect,drive,credit,influencer,post,reserved,close(){sql.close();globalThis.fetch=originalFetch}};
}
async function readyCharacter(f){await f.doConnect();await f.drive(8);assert.equal(f.influencer().status,'active');f.sql.exec('UPDATE influencers SET next_post_at=0');}

test('the influencer waits for X before designing or spending anything',async()=>{
 const f=fixture();try{await f.drive(3);assert.equal(f.influencer().status,'awaiting_x');assert.equal(f.calls.submits.length,0);assert.equal(f.credit(),5000000);assert.equal(f.reserved(),0);
  assert.equal(await influencerFunding('coin'),0,'no top-up is requested before X is connected');
 }finally{f.close()}
});
test('character design reserves once, trains one identity and settles the platform rate',async()=>{
 const f=fixture();try{await f.doConnect();await f.drive(8);const row=f.influencer();
  assert.equal(row.status,'active');assert.equal(row.character_id,CHARACTER);assert.ok(row.master_asset);assert.equal(f.calls.characters,1);
  const master=f.calls.submits.filter(s=>s.path==='/higgsfield-ai/soul/v2/standard');assert.equal(master.length,1);assert.match(master[0].body.prompt,/Full-body character design master image/);assert.match(master[0].body.prompt,/orange/,'logo palette steers the design');assert.equal(master[0].body.custom_reference_id,undefined);
  assert.equal(f.credit(),4500000);assert.equal(f.reserved(),0);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM influencer_assets WHERE kind='master'").get().n,1);
  const status=await influencerStatus({id:'coin',name:'Community',symbol:'SHEN',tokenAddress:'0x1'},false);assert.equal(status.status,'active');assert.match(status.characterImageUrl,/\/api\/coins\/coin\/influencer\/assets\//);assert.equal(status.referenceImageUrl,null);assert.equal(JSON.stringify(status).includes('higgsfield.test'),false,'provider URLs stay private');
 }finally{f.close()}
});
test('a video post is written, reviewed, generated, uploaded in chunks and posted exactly once',async()=>{
 const f=fixture();try{await readyCharacter(f);await f.drive(12);const p=f.post();
  assert.equal(p.status,'complete');assert.equal(p.kind,'video');assert.equal(p.tweet_id,'888');assert.equal(f.calls.posts,1);assert.equal(f.calls.videoInits,1);assert.equal(f.calls.appends,2);
  const image=f.calls.submits.find(s=>s.key.endsWith(':image')),video=f.calls.submits.find(s=>s.key.endsWith(':video'));
  assert.equal(image.body.custom_reference_id,CHARACTER,'every post uses the trained character');assert.equal(image.body.aspect_ratio,'9:16');assert.equal(video.path,'/kling-video/v3.0/std/image-to-video');assert.equal(video.body.image_url,'https://cdn.higgsfield.test/image.png');
  // 500 writing + 500 review + 60000 image + 400000 video + 5000 upload + 15000 post.
  assert.equal(f.credit(),4500000-481000);assert.equal(f.reserved(),0);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM events WHERE message LIKE 'AI influencer posted on X:%'").get().n,1);
  const status=await influencerStatus({id:'coin',name:'Community',symbol:'SHEN',tokenAddress:'0x1'},false);assert.equal(status.posts[0].tweetUrl,'https://x.com/i/status/888');assert.match(status.posts[0].caption,/Rooftop shift/);
 }finally{f.close()}
});
test('a lost X reply is reconciled from the timeline without a second post',async()=>{
 const f=fixture();try{await readyCharacter(f);f.state.losePost=true;
  for(let i=0;i<14&&f.post()?.status!=='uncertain';i++)await f.drive(1);
  assert.equal(f.post().status,'uncertain');assert.equal(f.calls.posts,1);
  f.state.losePost=false;await f.drive(2);assert.equal(f.post().status,'complete');assert.equal(f.post().tweet_id,'888');assert.equal(f.calls.posts,1);assert.equal(f.reserved(),0);
 }finally{f.close()}
});
test('an unverifiable post retains only its possible charge and is never resent',async()=>{
 const f=fixture();try{await readyCharacter(f);f.state.losePost=true;f.state.readAuthor='999';await f.drive(16);
  const p=f.post();assert.equal(p.status,'failed');assert.match(p.error,/reserved separately/);assert.equal(f.calls.posts,1);assert.equal(f.calls.reads,3);assert.equal(f.reserved(),1,'only the possible charge stays held');const hold=f.sql.prepare("SELECT reserved_microusd FROM agent_runs WHERE kind='provider_hold'").get();assert.equal(hold.reserved_microusd,15000);assert.equal(f.credit()+p.cost_microusd+hold.reserved_microusd,4500000);
 }finally{f.close()}
});
test('a declined image is not charged, and a declined review stops before generation',async()=>{
 const f=fixture();try{await readyCharacter(f);f.state.imageStatus='nsfw';const before=f.credit();await f.drive(6);
  assert.equal(f.post().status,'failed');assert.equal(f.calls.posts,0);assert.equal(f.credit(),before-1000,'only the two writing calls are charged');assert.equal(f.reserved(),0);
  f.state.imageStatus='completed';f.state.guardAllow=false;f.sql.exec('UPDATE influencers SET next_post_at=0');const submits=f.calls.submits.length;await f.drive(3);
  assert.equal(f.post().status,'failed');assert.match(f.post().error,/declined/);assert.equal(f.calls.submits.length,submits,'nothing was sent to Higgsfield');
 }finally{f.close()}
});
test('a timed-out Higgsfield submission retries with the same idempotency key',async()=>{
 const f=fixture();try{await f.doConnect();f.state.timeoutSubmitOnce=true;await f.drive(10);
  const keys=f.calls.submits.filter(s=>s.path==='/higgsfield-ai/soul/v2/standard').map(s=>s.key);assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.equal(f.influencer().status,'active');
 }finally{f.close()}
});
test('insufficient credit waits without reserving, and the planner is asked to top up',async()=>{
 const f=fixture({startCredit:1200000});try{await f.doConnect();await f.drive(2);assert.equal(f.influencer().status,'awaiting_funds');assert.equal(f.reserved(),0);assert.equal(f.calls.submits.length,0);
  assert.equal(await influencerFunding('coin'),1500000);
 }finally{f.close()}
});
test('a reference trains the identity first, then the master is drawn from it',async()=>{
 const f=fixture();try{
  f.sql.prepare("INSERT INTO influencer_assets(id,coin_id,kind,mime,base64,created_at) VALUES('ref','coin','reference','image/png',?,?)").run(png.toString('base64'),Date.now());
  await f.doConnect();await f.drive(10);
  assert.equal(f.influencer().status,'active');assert.equal(f.calls.storage,1);assert.deepEqual(f.calls.trainedOn,['https://cdn.higgsfield.test/reference.png']);
  const master=f.calls.submits.find(s=>s.path==='/higgsfield-ai/soul/v2/standard');assert.equal(master.body.custom_reference_id,CHARACTER);
  const owner=await influencerStatus({id:'coin',name:'Community',symbol:'SHEN',tokenAddress:'0x1'},true),visitor=await influencerStatus({id:'coin',name:'Community',symbol:'SHEN',tokenAddress:'0x1'},false);
  assert.match(owner.referenceImageUrl,/assets\/ref$/);assert.equal(visitor.referenceImageUrl,null,'the private reference is never listed publicly');
 }finally{f.close()}
});
test('photo posts upload the stored still and never call the video model',async()=>{
 const f=fixture();env.INFLUENCER_VIDEO_PERCENT='0';try{await readyCharacter(f);await f.drive(10);
  const p=f.post();assert.equal(p.kind,'photo');assert.equal(p.status,'complete');assert.equal(f.calls.imageUploads,1);assert.equal(f.calls.videoInits,0);
  assert.equal(f.calls.submits.some(s=>s.key.endsWith(':video')),false);assert.equal(f.calls.submits.find(s=>s.key.endsWith(':image')).body.aspect_ratio,'3:4');
  assert.equal(f.credit(),4500000-81000);assert.equal(f.reserved(),0);
 }finally{env.INFLUENCER_VIDEO_PERCENT='100';f.close()}
});
test('a slow accepted design keeps its request ID instead of purchasing a duplicate',async()=>{
 const f=fixture();try{await f.doConnect();f.state.imageStatus='in_progress';await f.drive(4);
  const waiting=f.influencer();assert.equal(waiting.status,'designing');assert.ok(waiting.design_request);assert.equal(waiting.attempts,0);
  f.sql.prepare("UPDATE influencers SET updated_at=? WHERE coin_id='coin'").run(Date.now()-1800001);await f.drive(1);
  const retried=f.influencer();assert.equal(retried.attempts,0);assert.equal(retried.design_request,waiting.design_request);assert.match(retried.last_error,/still processing/);assert.equal(f.calls.submits.length,1);assert.equal(f.reserved(),1,'the character reservation stays held for the retry');
 }finally{f.close()}
});
test('a platform credit or credential refusal waits without spending the character attempts',async()=>{
 const f=fixture();try{await f.doConnect();f.state.rejectStatus=402;await f.drive(3);
  const row=f.influencer();assert.equal(row.status,'designing');assert.equal(row.attempts,0);assert.match(row.last_error,/temporarily unavailable/);assert.ok(row.next_attempt_at>Date.now()+20*60000);
  f.state.rejectStatus=0;f.sql.exec('UPDATE influencers SET next_attempt_at=0');await f.drive(8);assert.equal(f.influencer().status,'active');
 }finally{f.close()}
});

test('a lost custom-reference creation response never purchases a second identity',async()=>{
 const f=fixture();try{await f.doConnect();f.state.loseCharacter=true;await f.drive(12);
  assert.equal(f.calls.characters,1);assert.equal(f.influencer().status,'failed');assert.match(f.influencer().last_error,/verification/);
  const hold=f.sql.prepare("SELECT reserved_microusd FROM agent_runs WHERE kind='provider_hold'").get();
  assert.equal(f.credit()+f.influencer().cost_microusd+hold.reserved_microusd,5000000);
 }finally{f.close();}
});
test('a lost media upload retains its possible charge without marking it spent or reuploading',async()=>{
 const f=fixture();env.INFLUENCER_VIDEO_PERCENT='0';try{await readyCharacter(f);f.state.loseUpload=true;await f.drive(12);
  assert.equal(f.calls.imageUploads,1);assert.equal(f.calls.posts,0);assert.equal(f.post().status,'failed');
  const hold=f.sql.prepare("SELECT reserved_microusd FROM agent_runs WHERE kind='provider_hold'").get();
  assert.equal(hold.reserved_microusd,5000);assert.equal(f.credit()+f.post().cost_microusd+hold.reserved_microusd,4500000);
 }finally{env.INFLUENCER_VIDEO_PERCENT='100';f.close();}
});


test('the coin artwork supplies the identity when no separate reference is uploaded',async()=>{
 const f=fixture();try{
  f.sql.prepare("INSERT INTO coin_images(coin_id,mime,base64) VALUES('coin','image/png',?)").run(png.toString('base64'));
  await f.doConnect();await f.drive(10);
  assert.equal(f.influencer().status,'active');assert.equal(f.calls.storage,1);
  assert.deepEqual(f.calls.trainedOn,['https://cdn.higgsfield.test/reference.png']);
  assert.equal(f.calls.submits.find(s=>s.path==='/higgsfield-ai/soul/v2/standard').body.custom_reference_id,CHARACTER);
  assert.equal(f.credit(),4500000,'character setup is charged once');
 }finally{f.close()}
});

test('Genjutsu snapshots the motion source and charges the reserved clip tariff once',async()=>{
 const f=fixture();env.HIGGSFIELD_VIDEO_MODEL='genjutsu';env.HIGGSFIELD_MOTION_REFERENCE_URL='https://cdn.example.com/motion.mp4';
 try{
  await readyCharacter(f);await f.drive(1);
  assert.equal(JSON.parse(f.post().billing).videoConfig.model,'genjutsu');
  env.HIGGSFIELD_VIDEO_MODEL='kling';env.HIGGSFIELD_MOTION_REFERENCE_URL='https://cdn.example.com/other.mp4';env.HIGGSFIELD_VIDEO_COST_MICROUSD='900000';
  await f.drive(12);
  const video=f.calls.submits.find(s=>s.key.endsWith(':video'));
  assert.equal(video.path,'/higgsfield/genjutsu/motion-transfer/v1.0');assert.equal(video.body.video_url,'https://cdn.example.com/motion.mp4');
  assert.deepEqual(video.body.image_urls,['https://cdn.higgsfield.test/image.png']);
  assert.equal(f.post().status,'complete');assert.equal(f.calls.posts,1);assert.equal(f.credit(),4500000-481000);assert.equal(f.reserved(),0);
  await f.drive(2);assert.equal(f.credit(),4500000-481000,'another worker pass cannot settle twice');
 }finally{delete env.HIGGSFIELD_VIDEO_MODEL;delete env.HIGGSFIELD_MOTION_REFERENCE_URL;env.HIGGSFIELD_VIDEO_COST_MICROUSD='400000';f.close()}
});

test('missing Genjutsu motion input keeps photo posts available without a video charge',async()=>{
 const f=fixture();env.HIGGSFIELD_VIDEO_MODEL='genjutsu';try{
  await readyCharacter(f);await f.drive(10);
  assert.equal(f.post().kind,'photo');assert.equal(f.post().status,'complete');assert.equal(f.calls.submits.some(s=>s.key.endsWith(':video')),false);
  assert.equal(f.credit(),4500000-81000);assert.equal(f.reserved(),0);
 }finally{delete env.HIGGSFIELD_VIDEO_MODEL;f.close()}
});

test('a rejected video submission publishes the completed photo and refunds the video allowance',async()=>{
 const f=fixture();try{await readyCharacter(f);f.state.rejectVideo=true;await f.drive(12);
  assert.equal(f.post().status,'complete');assert.equal(f.post().kind,'photo');assert.equal(f.calls.posts,1);
  assert.equal(f.credit(),4500000-81000);assert.equal(f.reserved(),0);
 }finally{f.close()}
});

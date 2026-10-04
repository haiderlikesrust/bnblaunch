import { env } from 'cloudflare:workers';
import { db, type CoinRow } from './server';
import { imageQuote, generateImage, ProviderFailure, type ImageQuote } from './content-providers';
import { xProvider, XAccessRevoked } from './x-official';
import { IMAGE_MODEL, matchingTweet, publicationInput, validatePublication, type Publication } from './content-policy';
import { xAccount, xConfigured, xCosts, xSession, xConnected, xMediaConfigured, revokeXSession, type XAccount } from './social-config';
import type { Coin } from './model';

type Job={x_provider:string;billing:string|null;id:string;coin_id:string;payload:string;status:string;quote:string|null;user_id:string|null;media_id:string|null;tweet_id:string|null;reserved_microusd:number;cost_microusd:number;attempts:number;posting_at:number|null;created_at:number;updated_at:number};
const unsettled="('queued','reserved','generating','image_ready','uploading','media_ready','posting','uncertain','reconciling')";
export function contentJobStatement(lease:{coinId:string;id:string},id:string,publication:Publication){const now=Date.now();return db().prepare(`INSERT INTO content_jobs(id,coin_id,payload,status,created_at,updated_at,x_provider)
 SELECT ?,?,?,'queued',?,?,'official' WHERE EXISTS(SELECT 1 FROM runtime_leases WHERE coin_id=? AND lease_id=? AND lease_until>?)
 AND NOT EXISTS(SELECT 1 FROM content_jobs WHERE coin_id=? AND status IN ${unsettled})
 AND NOT EXISTS(SELECT 1 FROM content_jobs WHERE coin_id=? AND created_at>?)
 AND (SELECT COUNT(*) FROM content_jobs WHERE coin_id=? AND created_at>?)<8
 AND NOT EXISTS(SELECT 1 FROM content_jobs WHERE coin_id=? AND payload=? AND created_at>?)`)
 .bind(id,lease.coinId,JSON.stringify(publication),now,now,lease.coinId,lease.id,now,lease.coinId,lease.coinId,now-3600000,lease.coinId,now-86400000,lease.coinId,JSON.stringify(publication),now-86400000);}
export async function contentSnapshot(coin:Coin){const [account,jobs]=await Promise.all([xAccount(coin.id),db().prepare('SELECT payload,status,tweet_id,created_at FROM content_jobs WHERE coin_id=? ORDER BY created_at DESC LIMIT 5').bind(coin.id).all<{payload:string;status:string;tweet_id:string|null;created_at:number}>()]);return {xConnected:xConnected(account),canPostImages:xMediaConfigured(),xUsername:account?.username??null,recent:jobs.results.map(j=>({publication:JSON.parse(j.payload),status:j.status,tweetId:j.tweet_id,createdAt:j.created_at}))};}
export async function contentCapabilities(){const value:string[]=[];if(xConfigured())try{if(await xProvider(env.X_API_BEARER_TOKEN!).balance()>xCosts().post+xCosts().upload+xCosts().read*3)value.push('x-publishing')}catch{}if(env.OPENROUTER_API_KEY)try{await imageQuote(env.OPENROUTER_IMAGE_MODEL||IMAGE_MODEL);value.push('image-publishing')}catch{}return value;}
async function claim(job:Job,status:string){const version=Math.max(Date.now(),job.updated_at+1);const r=await db().prepare('UPDATE content_jobs SET status=?,updated_at=? WHERE id=? AND status=? AND updated_at=?').bind(status,version,job.id,job.status,job.updated_at).run();if(r.meta.changes){job.status=status;job.updated_at=version;return true}return false;}
async function finish(job:Job,status:'complete'|'failed',cost:number,message:string,tweetId:string|null=null){
 if(!Number.isSafeInteger(cost)||cost<0||cost>job.reserved_microusd)throw new ProviderFailure();
 // The job state/version fences every write in this transaction. A delayed
 // expiry or gallery turn must never refund a job another turn is publishing.
 const fence="EXISTS(SELECT 1 FROM content_jobs WHERE id=? AND status=? AND updated_at=?)",version=Math.max(Date.now(),job.updated_at+1);
 await db().batch([
  db().prepare("UPDATE coins SET ai_credit_microusd=ai_credit_microusd+? WHERE id=? AND EXISTS(SELECT 1 FROM agent_runs WHERE id=? AND status='reserved') AND "+fence).bind(job.reserved_microusd-cost,job.coin_id,'content:'+job.id,job.id,job.status,job.updated_at),
  db().prepare("UPDATE agent_runs SET status='settled',cost_microusd=?,output=?,finished_at=? WHERE id=? AND status='reserved' AND "+fence).bind(cost,message,new Date().toISOString(),'content:'+job.id,job.id,job.status,job.updated_at),
  db().prepare('UPDATE content_jobs SET status=?,cost_microusd=?,tweet_id=COALESCE(?,tweet_id),updated_at=? WHERE id=? AND status=? AND updated_at=?').bind(status,cost,tweetId,version,job.id,job.status,job.updated_at),
  db().prepare("INSERT INTO events(id,coin_id,owner,name,message,created_at) SELECT ?,id,owner,json_extract(config,'$.name'),?,? FROM coins WHERE id=? AND "+fence+" ON CONFLICT(id) DO NOTHING").bind('content-result:'+job.id,message,new Date().toISOString(),job.coin_id,job.id,status,version),
 ]);
}
async function reserveJob(job:Job,coin:Coin,publication:Publication){
 const account=await xAccount(job.coin_id);validatePublication(publication,{social:coin.social,images:coin.images,connected:xConnected(account)});
 const quote=publication.imagePrompt?await imageQuote(env.OPENROUTER_IMAGE_MODEL||IMAGE_MODEL):null,costs=xCosts(publication.text);
 if(publication.destination==='x'&&publication.imagePrompt&&!xMediaConfigured())return false;
 if(publication.destination==='x'&&(!xConfigured()||await xProvider(env.X_API_BEARER_TOKEN!).balance()<costs.post+costs.upload+costs.read*3))return false;
 const ceiling=(quote?.ceiling??0)+(publication.destination==='x'?costs.post+(quote?costs.upload:0)+costs.read*3:0),now=Date.now();
 const result=await db().batch([
  db().prepare(`INSERT INTO agent_runs(id,coin_id,kind,status,reserved_microusd,created_at) SELECT ?,id,'content','reserved',?,? FROM coins WHERE id=? AND ai_credit_microusd>=?
   AND EXISTS(SELECT 1 FROM content_jobs WHERE id=? AND status='queued')
   AND NOT EXISTS(SELECT 1 FROM agent_runs WHERE coin_id=coins.id AND status='reserved')
   ON CONFLICT(id) DO NOTHING`).bind('content:'+job.id,ceiling,new Date(now).toISOString(),job.coin_id,ceiling,job.id),
  db().prepare("UPDATE coins SET ai_credit_microusd=ai_credit_microusd-? WHERE id=? AND EXISTS(SELECT 1 FROM agent_runs WHERE id=? AND status='reserved') AND EXISTS(SELECT 1 FROM content_jobs WHERE id=? AND status='queued')").bind(ceiling,job.coin_id,'content:'+job.id,job.id),
  db().prepare("UPDATE content_jobs SET status='reserved',next_attempt_at=0,quote=?,user_id=?,billing=?,reserved_microusd=?,updated_at=? WHERE id=? AND status='queued' AND EXISTS(SELECT 1 FROM agent_runs WHERE id=? AND status='reserved')").bind(quote?JSON.stringify(quote):null,account?.user_id??null,JSON.stringify(costs),ceiling,now,job.id,'content:'+job.id),
 ]);return !!result[0].meta.changes;
}
export async function runContentTick(){
 const now=Date.now();
 // A process may die after sending a write but before persisting its reply.
 // Expiry never resets these states to a sendable stage.
 await db().prepare("UPDATE content_jobs SET attempts=CASE WHEN status='reconciling' THEN 3 ELSE attempts END,status='uncertain',updated_at=? WHERE status IN ('generating','uploading','posting','reconciling') AND updated_at<?").bind(now,now-300000).run();
 const job=await db().prepare(`SELECT * FROM content_jobs WHERE (x_provider='official' OR json_extract(payload,'$.destination')='gallery') AND next_attempt_at<=? AND (status IN ('queued','reserved','image_ready','media_ready') OR (status='uncertain' AND posting_at IS NOT NULL AND attempts<3 AND updated_at<?)) ORDER BY next_attempt_at,created_at LIMIT 1`).bind(now,now-60000).first<Job>();
 if(!job)return {processed:false};
 const turn=await db().prepare('UPDATE content_jobs SET next_attempt_at=? WHERE id=? AND next_attempt_at<=?').bind(now+90000,job.id,now).run();if(!turn.meta.changes)return {processed:false};
 const row=await db().prepare('SELECT * FROM coins WHERE id=? AND token_address IS NOT NULL').bind(job.coin_id).first<CoinRow>();if(!row)return {processed:false};
 const coin=JSON.parse(row.config) as Coin,publication=publicationInput.parse(JSON.parse(job.payload)),costs=job.billing?JSON.parse(job.billing) as ReturnType<typeof xCosts>:xCosts(publication.text);
 let activeXAccount:XAccount|null=null;
 try{
  if(Date.now()-job.created_at>21600000&&['queued','reserved','image_ready','media_ready'].includes(job.status)){await finish(job,'failed',job.cost_microusd,'A community update expired before publication.');return {processed:true};}
  if(job.status==='queued')return {processed:await reserveJob(job,coin,publication)};
  if(job.status==='uncertain'){
   activeXAccount=await xAccount(job.coin_id);
   if(!job.user_id||!activeXAccount||activeXAccount.user_id!==job.user_id)return {processed:false};
   const readSession=await xSession(activeXAccount);
   if(await xProvider(env.X_API_BEARER_TOKEN!).balance()<costs.read||!await claim(job,'reconciling'))return {processed:false};
   await db().prepare('UPDATE content_jobs SET attempts=attempts+1 WHERE id=?').bind(job.id).run();
   const tweets=await xProvider(env.X_API_BEARER_TOKEN!).tweets(readSession,job.user_id,job.tweet_id??undefined);
   const readCost=tweets.length*5000;
   if(readCost>costs.read)throw new ProviderFailure();
   const cost=job.cost_microusd+readCost;
   const match=matchingTweet(tweets,{userId:job.user_id,text:publication.text,startedAt:job.posting_at!,mediaId:job.media_id});
   if(match)await finish(job,'complete',cost+costs.post,'Published on X: https://x.com/i/status/'+match,match);
   else await db().prepare("UPDATE content_jobs SET status='uncertain',cost_microusd=?,updated_at=? WHERE id=? AND status='reconciling'").bind(cost,Date.now(),job.id).run();
   return {processed:true};
  }
  if(job.status==='reserved'&&publication.imagePrompt){
   const quote=JSON.parse(job.quote!) as ImageQuote,current=await imageQuote(quote.model);
   if(current.provider!==quote.provider||current.ceiling>quote.ceiling){if(await claim(job,'generating'))await finish(job,'failed',0,'Artwork deferred because image pricing changed.');return {processed:true};}
   if(!await claim(job,'generating'))return {processed:false};
   const image=await generateImage(env.OPENROUTER_API_KEY!,quote,'Create original community artwork. Do not fabricate charts, transaction receipts, endorsements, partnerships, or real events. No price promises or financial claims. Brief: '+publication.imagePrompt);
   await db().batch([
    db().prepare('INSERT INTO content_assets(id,coin_id,mime,base64,model,alt_text,created_at) VALUES(?,?,?,?,?,?,?)').bind(job.id,job.coin_id,image.mime,image.base64,quote.model,publication.altText||publication.text,Date.now()),
    db().prepare("UPDATE content_jobs SET status='image_ready',next_attempt_at=0,cost_microusd=?,updated_at=? WHERE id=? AND status='generating'").bind(image.cost,Date.now(),job.id),
   ]);return {processed:true};
  }
  if(publication.destination==='gallery'){
   if(!['image_ready','media_ready'].includes(job.status))return {processed:false};
   await finish(job,'complete',job.cost_microusd,'Created community artwork.');return {processed:true};
  }
  const account=await xAccount(job.coin_id);if(!account||account.user_id!==job.user_id)throw new ProviderFailure();activeXAccount=account;const session=await xSession(account),provider=xProvider(env.X_API_BEARER_TOKEN!);
  if(await provider.balance()<costs.post+(job.status==='image_ready'?costs.upload:0)+costs.read*3)return {processed:false};
  if(job.status==='image_ready'){
   const asset=await db().prepare('SELECT mime,base64 FROM content_assets WHERE id=? AND coin_id=?').bind(job.id,job.coin_id).first<{mime:string;base64:string}>();if(!asset)throw new ProviderFailure();
   const bytes=Uint8Array.from(atob(asset.base64),c=>c.charCodeAt(0));if(!await claim(job,'uploading'))return {processed:false};
   const mediaId=await provider.upload(session,new File([bytes],'community.'+asset.mime.split('/')[1],{type:asset.mime}));
   if(!/^\d+$/.test(mediaId))throw new ProviderFailure();
   await db().prepare("UPDATE content_jobs SET status='media_ready',next_attempt_at=0,media_id=?,cost_microusd=cost_microusd+?,updated_at=? WHERE id=? AND status='uploading'").bind(mediaId,costs.upload,Date.now(),job.id).run();return {processed:true};
  }
  if(job.status==='reserved'||job.status==='media_ready'){
   // The network write follows one conditional database claim. Neither an
   // HTTP timeout nor a worker restart may claim this job for posting again.
   if(!await claim(job,'posting'))return {processed:false};
   await db().prepare('UPDATE content_jobs SET posting_at=? WHERE id=?').bind(Date.now(),job.id).run();
   const tweetId=await provider.post(session,publication.text,job.media_id);if(!/^\d+$/.test(tweetId))throw new ProviderFailure();
   await db().prepare('UPDATE content_jobs SET tweet_id=? WHERE id=?').bind(tweetId,job.id).run();
   await finish(job,'complete',job.cost_microusd+costs.post,'Published on X: https://x.com/i/status/'+tweetId,tweetId);return {processed:true};
  }
 }catch(e){
  if(e instanceof XAccessRevoked&&activeXAccount)await revokeXSession(activeXAccount);
  const current=await db().prepare('SELECT * FROM content_jobs WHERE id=?').bind(job.id).first<Job>();
  if(current&&['generating','uploading','posting','reconciling'].includes(current.status)){
   if(e instanceof ProviderFailure&&!e.uncertain&&e.cost!==null&&current.status==='generating')await finish(current,'failed',current.cost_microusd+e.cost,'Image generation could not complete. Known service costs were recorded.');
   else await db().batch([
    db().prepare("UPDATE content_jobs SET attempts=CASE WHEN status='reconciling' THEN 3 ELSE attempts END,status='uncertain',updated_at=? WHERE id=?").bind(Date.now(),job.id),
    db().prepare("INSERT INTO events(id,coin_id,owner,name,message,created_at) SELECT ?,id,owner,json_extract(config,'$.name'),'A publishing result is awaiting verification. No duplicate post will be sent.',? FROM coins WHERE id=? ON CONFLICT(id) DO NOTHING").bind('content-review:'+job.id,new Date().toISOString(),job.coin_id),
   ]);
  }
  return {processed:false,reason:'content_service_pending'};
 }
 return {processed:false};
}

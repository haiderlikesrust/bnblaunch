import { isolatedProviderHold, providerHoldStatement } from './provider-holds';
import { env } from 'cloudflare:workers';
import { db, type CoinRow } from './server';
import { imageQuote, availableImageQuote, generateImage, ProviderFailure, type ImageQuote } from './content-providers';
import { xProvider, XAccessRevoked, XHttpFailure } from './x-official';
import { IMAGE_MODEL, supportedImageModels, matchingTweet, publicationInput, validatePublication, type Publication } from './content-policy';
import { xAccount, xConfigured, xCosts, xSession, xConnected, xMediaConfigured, revokeXSession, type XAccount } from './social-config';
import type { Coin } from './model';

type Job={x_provider:string;billing:string|null;id:string;coin_id:string;payload:string;status:string;quote:string|null;user_id:string|null;media_id:string|null;tweet_id:string|null;reserved_microusd:number;cost_microusd:number;attempts:number;posting_at:number|null;created_at:number;updated_at:number};
const unsettled="('queued','reserved','generating','image_ready','uploading','media_ready','posting','uncertain','reconciling')";
export function contentJobStatement(lease:{coinId:string;id:string},id:string,publication:Publication,nextPublicationAt=Date.now()){const now=Date.now();return db().prepare(`INSERT INTO content_jobs(id,coin_id,payload,status,created_at,updated_at,x_provider,next_attempt_at)
 SELECT ?,?,?,'queued',?,?,'official',? WHERE EXISTS(SELECT 1 FROM runtime_leases WHERE coin_id=? AND lease_id=? AND lease_until>?)
 AND NOT EXISTS(SELECT 1 FROM content_jobs WHERE coin_id=? AND status IN ${unsettled})
 AND NOT EXISTS(SELECT 1 FROM content_jobs WHERE coin_id=? AND json_extract(payload,'$.text')=? AND created_at>?)`)
 .bind(id,lease.coinId,JSON.stringify(publication),now,now,Math.max(now,nextPublicationAt),lease.coinId,lease.id,now,lease.coinId,lease.coinId,publication.text,now-86400000);}
export async function contentSnapshot(coin:Coin){const [account,jobs]=await Promise.all([xAccount(coin.id),db().prepare('SELECT id,payload,status,tweet_id,created_at FROM content_jobs WHERE coin_id=? ORDER BY created_at DESC LIMIT 5').bind(coin.id).all<{id:string;payload:string;status:string;tweet_id:string|null;created_at:number}>()]);return {publicationPending:jobs.results.some(j=>!['complete','failed'].includes(j.status)),xConnected:xConnected(account),canPostImages:xMediaConfigured(),xUsername:account?.username??null,recent:jobs.results.map(j=>({id:j.id,publication:JSON.parse(j.payload),status:j.status,tweetId:j.tweet_id,createdAt:j.created_at}))};}
export async function publicationSchedule(coinId:string,intervalMinutes:number){
 const last=await db().prepare("SELECT MAX(updated_at) AS at FROM content_jobs WHERE coin_id=? AND status='complete'").bind(coinId).first<{at:number|null}>();
 const nextAt=last?.at?Math.max(Date.now(),last.at+intervalMinutes*60000):Date.now();
 // A draft is queued once. Stronger/weaker activity adjusts its due time, not
 // its content. Once reserved or dispatched, never reschedule or replay it.
 await db().prepare("UPDATE content_jobs SET next_attempt_at=? WHERE coin_id=? AND status='queued' AND NOT EXISTS(SELECT 1 FROM agent_runs WHERE id='content:'||content_jobs.id)").bind(nextAt,coinId).run();
 return {intervalMinutes,nextAt,ready:nextAt<=Date.now(),dailyLimit:null};
}
export async function contentCapabilities(){const value:string[]=[];if(xConfigured())try{if(await xProvider(env.X_API_BEARER_TOKEN!).balance()>xCosts().post+xCosts().upload+xCosts().read*3)value.push('x-publishing')}catch{}if(env.OPENROUTER_API_KEY)try{await availableImageQuote(env.OPENROUTER_IMAGE_MODEL||IMAGE_MODEL);value.push('image-publishing')}catch{}return value;}
// posting_at is written in the same claim, so a crash can never leave a
// posting job without the time its possible post must be matched against.
async function claim(job:Job,status:string,postingAt:number|null=null){const version=Math.max(Date.now(),job.updated_at+1);const r=await db().prepare('UPDATE content_jobs SET status=?,updated_at=?,posting_at=COALESCE(?,posting_at) WHERE id=? AND status=? AND updated_at=?').bind(status,version,postingAt,job.id,job.status,job.updated_at).run();if(r.meta.changes){job.status=status;job.updated_at=version;if(postingAt)job.posting_at=postingAt;return true}return false;}
const definitiveX=(error:unknown):error is XHttpFailure=>error instanceof XHttpFailure&&error.status>=400&&error.status<500&&error.status!==429&&error.status!==408;
async function finish(job:Job,status:'complete'|'failed',cost:number,message:string,tweetId:string|null=null,fallback:Publication|null=null,unknownCost=0){
 if(!Number.isSafeInteger(cost)||cost<0||!Number.isSafeInteger(unknownCost)||unknownCost<0||cost+unknownCost>job.reserved_microusd)throw new ProviderFailure();
 // The job state/version fences every write in this transaction. A delayed
 // expiry or gallery turn must never refund a job another turn is publishing.
 const fence="EXISTS(SELECT 1 FROM content_jobs WHERE id=? AND status=? AND updated_at=?)",version=Math.max(Date.now(),job.updated_at+1);
 await db().batch([
  ...(unknownCost?[providerHoldStatement('content:'+job.id,job.coin_id,unknownCost,{sql:fence,values:[job.id,job.status,job.updated_at]})]:[]),
  db().prepare("UPDATE coins SET ai_credit_microusd=ai_credit_microusd+? WHERE id=? AND EXISTS(SELECT 1 FROM agent_runs WHERE id=? AND status='reserved') AND "+fence).bind(job.reserved_microusd-cost-unknownCost,job.coin_id,'content:'+job.id,job.id,job.status,job.updated_at),
  db().prepare("UPDATE agent_runs SET status='settled',cost_microusd=?,output=?,finished_at=? WHERE id=? AND status='reserved' AND "+fence).bind(cost,message,new Date().toISOString(),'content:'+job.id,job.id,job.status,job.updated_at),
  db().prepare('UPDATE content_jobs SET status=?,cost_microusd=?,tweet_id=COALESCE(?,tweet_id),payload=COALESCE(?,payload),updated_at=? WHERE id=? AND status=? AND updated_at=?').bind(status,cost,tweetId,fallback?JSON.stringify(fallback):null,version,job.id,job.status,job.updated_at),
  db().prepare("INSERT INTO events(id,coin_id,owner,name,message,created_at) SELECT ?,id,owner,json_extract(config,'$.name'),?,? FROM coins WHERE id=? AND "+fence+" ON CONFLICT(id) DO NOTHING").bind('content-result:'+job.id,message,new Date().toISOString(),job.coin_id,job.id,status,version),
 ]);
}
async function reserveJob(job:Job,coin:Coin,publication:Publication){
 const account=await xAccount(job.coin_id);validatePublication(publication,{social:coin.social,images:coin.images,connected:xConnected(account)});
 let quote:ImageQuote|null=null;
 if(publication.imagePrompt){
  try{quote=await availableImageQuote(env.OPENROUTER_IMAGE_MODEL||IMAGE_MODEL);}catch(error){if(publication.destination!=='gallery')throw error;}
  const funds=await db().prepare('SELECT ai_credit_microusd AS credit FROM coins WHERE id=?').bind(job.coin_id).first<{credit:number}>();
  if(publication.destination==='gallery'&&(!quote||Number(funds?.credit??0)<quote.ceiling)){
   publication={...publication,imagePrompt:null,altText:''};quote=null;
   await db().prepare("UPDATE content_jobs SET payload=? WHERE id=? AND status='queued'").bind(JSON.stringify(publication),job.id).run();
  }
 }
 const costs=publication.destination==='x'?xCosts(publication.text):{post:0,upload:0,read:0};
 if(publication.destination==='x'&&publication.imagePrompt&&!xMediaConfigured())return false;
 if(publication.destination==='x'&&(!xConfigured()||await xProvider(env.X_API_BEARER_TOKEN!).balance()<costs.post+costs.upload+costs.read*3))return false;
 const ceiling=(quote?.ceiling??0)+(publication.destination==='x'?costs.post+(quote?costs.upload:0)+costs.read*3:0),now=Date.now();
 const result=await db().batch([
  db().prepare(`INSERT INTO agent_runs(id,coin_id,kind,status,reserved_microusd,created_at) SELECT ?,id,'content','reserved',?,? FROM coins WHERE id=? AND ai_credit_microusd>=?
   AND EXISTS(SELECT 1 FROM content_jobs WHERE id=? AND status='queued')
   AND NOT EXISTS(SELECT 1 FROM agent_runs r WHERE r.coin_id=coins.id AND r.status='reserved' AND NOT (r.kind='influencer' OR (${isolatedProviderHold})))
   ON CONFLICT(id) DO NOTHING`).bind('content:'+job.id,ceiling,new Date(now).toISOString(),job.coin_id,ceiling,job.id),
  db().prepare("UPDATE coins SET ai_credit_microusd=ai_credit_microusd-? WHERE id=? AND EXISTS(SELECT 1 FROM agent_runs WHERE id=? AND status='reserved') AND EXISTS(SELECT 1 FROM content_jobs WHERE id=? AND status='queued')").bind(ceiling,job.coin_id,'content:'+job.id,job.id),
  db().prepare("UPDATE content_jobs SET status='reserved',next_attempt_at=0,quote=?,user_id=?,billing=?,reserved_microusd=?,updated_at=? WHERE id=? AND status='queued' AND EXISTS(SELECT 1 FROM agent_runs WHERE id=? AND status='reserved')").bind(quote?JSON.stringify(quote):null,account?.user_id??null,JSON.stringify(costs),ceiling,now,job.id,'content:'+job.id),
 ]);return !!result[0].meta.changes;
}
export async function runContentTick(){
 const now=Date.now();
 // A process may die after sending a write but before persisting its reply.
 // Expiry never resets these states to a sendable stage.
 await db().prepare("UPDATE content_jobs SET status='uncertain',updated_at=? WHERE status IN ('generating','uploading','posting','reconciling') AND updated_at<?").bind(now,now-300000).run();
 const job=await db().prepare(`SELECT * FROM content_jobs WHERE (x_provider='official' OR json_extract(payload,'$.destination')='gallery') AND next_attempt_at<=? AND (status IN ('queued','reserved','image_ready','media_ready') OR (status='uncertain' AND updated_at<?)) ORDER BY next_attempt_at,created_at LIMIT 1`).bind(now,now-60000).first<Job>();
 if(!job)return {processed:false};
 const turn=await db().prepare('UPDATE content_jobs SET next_attempt_at=? WHERE id=? AND next_attempt_at<=?').bind(now+90000,job.id,now).run();if(!turn.meta.changes)return {processed:false};
 const row=await db().prepare('SELECT * FROM coins WHERE id=? AND token_address IS NOT NULL').bind(job.coin_id).first<CoinRow>();if(!row)return {processed:false};
 const coin=JSON.parse(row.config) as Coin,publication=publicationInput.parse(JSON.parse(job.payload)),costs=publication.destination==='gallery'?{post:0,upload:0,read:0}:job.billing?JSON.parse(job.billing) as ReturnType<typeof xCosts>:xCosts(publication.text);
 let activeXAccount:XAccount|null=null;
 try{
  if(Date.now()-job.created_at>21600000&&['queued','reserved','image_ready','media_ready'].includes(job.status)){await finish(job,'failed',job.cost_microusd,'A community update expired before publication.');return {processed:true};}
  if(job.status==='queued')return {processed:await reserveJob(job,coin,publication)};
  if(job.status==='uncertain'){
   // Every uncertain job reaches a final state. A possible post is looked up on
   // the timeline first; nothing is ever resent, and no credit stays held.
   const settle=(cost:number,status:'complete'|'failed',message:string,tweetId:string|null=null,fallback:Publication|null=null,unknownCost=0)=>finish(job,status,cost,message,tweetId,fallback,unknownCost).then(()=>({processed:true}));
   if(job.tweet_id)return settle(job.cost_microusd+costs.post,'complete','Published on X: https://x.com/i/status/'+job.tweet_id,job.tweet_id);
   const quote=job.quote?JSON.parse(job.quote) as ImageQuote:null,asset=publication.imagePrompt?await db().prepare('SELECT id FROM content_assets WHERE id=?').bind(job.id).first():null;
   // Interrupted before posting: retain the possible generation or upload charge separately.
   if(publication.imagePrompt&&!job.media_id&&job.posting_at===null){
    const unknown=asset?costs.upload:quote?.ceiling??0,cost=job.cost_microusd;
    if(publication.destination==='gallery')return settle(cost,'complete','Published the approved community text; the artwork result could not be verified.',null,{...publication,imagePrompt:null,altText:''},unknown);
    return settle(cost,'failed',asset?'The media upload could not be verified; upload credit stays reserved separately. Nothing was posted.':'Artwork generation could not be verified; its credit stays reserved separately. Nothing was posted.',null,null,unknown);
   }
   if(publication.destination==='gallery')return settle(job.cost_microusd,'complete',publication.imagePrompt?'Created community artwork.':'Published a community update.');
   const published='X did not confirm this publication. Its possible charge stays reserved separately; it will not be resent.';
   if(job.attempts>=3)return settle(job.cost_microusd,'failed',published,null,null,costs.post);
   activeXAccount=await xAccount(job.coin_id);
   if(!job.user_id||!activeXAccount||activeXAccount.user_id!==job.user_id||!xConnected(activeXAccount)){if(Date.now()-job.updated_at>3600000)return settle(job.cost_microusd,'failed',published,null,null,costs.post);return {processed:false};}
   const readSession=await xSession(activeXAccount);
   if(await xProvider(env.X_API_BEARER_TOKEN!).balance()<costs.read||!await claim(job,'reconciling'))return {processed:false};
   await db().prepare('UPDATE content_jobs SET attempts=attempts+1 WHERE id=?').bind(job.id).run();
   const since=job.posting_at??job.created_at,tweets=await xProvider(env.X_API_BEARER_TOKEN!).tweets(readSession,job.user_id,undefined,since-60000);
   const cost=job.cost_microusd+Math.min(tweets.length*5000,costs.read);
   const match=matchingTweet(tweets,{userId:job.user_id,text:publication.text,startedAt:since,mediaId:job.media_id,...(job.posting_at===null?{until:Date.now()}:{})});
   if(match)await finish(job,'complete',cost+costs.post,'Published on X: https://x.com/i/status/'+match,match);
   else await db().prepare("UPDATE content_jobs SET status='uncertain',cost_microusd=?,updated_at=? WHERE id=? AND status='reconciling'").bind(cost,Date.now(),job.id).run();
   return {processed:true};
  }
  if(job.status==='reserved'&&publication.imagePrompt){
   let quote=JSON.parse(job.quote!) as ImageQuote;const current=await imageQuote(quote.model);
   if(current.provider!==quote.provider||current.ceiling>quote.ceiling){if(await claim(job,'generating'))await finish(job,publication.destination==='gallery'?'complete':'failed',0,'Artwork deferred because image pricing changed.',null,publication.destination==='gallery'?{...publication,imagePrompt:null,altText:''}:null);return {processed:true};}
   if(!await claim(job,'generating'))return {processed:false};
   const prompt='Create original community artwork. Do not fabricate charts, transaction receipts, endorsements, partnerships, or real events. No price promises or financial claims. Brief: '+publication.imagePrompt;
   let image;
   try{image=await generateImage(env.OPENROUTER_API_KEY!,quote,prompt);}
   catch(error){
    // Only a confirmed, zero-charge failure permits a different paid request.
    // Timeouts or missing receipts keep the original reservation for review.
    if(!(error instanceof ProviderFailure)||error.uncertain||error.cost!==0)throw error;
    const alternate=supportedImageModels.find(id=>id!==quote.model);if(!alternate)throw error;
    const next=await imageQuote(alternate).catch(()=>null);if(!next||next.ceiling>quote.ceiling)throw error;
    const saved=await db().prepare("UPDATE content_jobs SET quote=? WHERE id=? AND status='generating' AND updated_at=?").bind(JSON.stringify(next),job.id,job.updated_at).run();
    if(!saved.meta.changes)return {processed:false};
    quote=next;image=await generateImage(env.OPENROUTER_API_KEY!,quote,prompt);
   }
   await db().batch([
    db().prepare('INSERT INTO content_assets(id,coin_id,mime,base64,model,alt_text,created_at) VALUES(?,?,?,?,?,?,?)').bind(job.id,job.coin_id,image.mime,image.base64,quote.model,publication.altText||publication.text,Date.now()),
    db().prepare("UPDATE content_jobs SET status='image_ready',next_attempt_at=0,cost_microusd=?,updated_at=? WHERE id=? AND status='generating'").bind(image.cost,Date.now(),job.id),
   ]);return {processed:true};
  }
  if(publication.destination==='gallery'){
   if(!['image_ready','media_ready'].includes(job.status)&&!(job.status==='reserved'&&!publication.imagePrompt))return {processed:false};
   await finish(job,'complete',job.cost_microusd,publication.imagePrompt?'Created community artwork.':'Published a community update.');return {processed:true};
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
   if(!await claim(job,'posting',Date.now()))return {processed:false};
   const tweetId=await provider.post(session,publication.text,job.media_id);if(!/^\d+$/.test(tweetId))throw new ProviderFailure();
   await db().prepare('UPDATE content_jobs SET tweet_id=? WHERE id=?').bind(tweetId,job.id).run();
   await finish(job,'complete',job.cost_microusd+costs.post,'Published on X: https://x.com/i/status/'+tweetId,tweetId);return {processed:true};
  }
 }catch(e){
  if(e instanceof ProviderFailure)console.warn(`Community provider result [${e.httpStatus===null?'unverified':`HTTP ${e.httpStatus}`}]: ${e.uncertain?'verification required':'confirmed failure'}.`);
  if(e instanceof XAccessRevoked&&activeXAccount)await revokeXSession(activeXAccount);
  const current=await db().prepare('SELECT * FROM content_jobs WHERE id=?').bind(job.id).first<Job>();
  if(current&&['generating','uploading','posting','reconciling'].includes(current.status)){
   if(e instanceof ProviderFailure&&!e.uncertain&&e.cost!==null&&current.status==='generating'){
    if(publication.destination==='gallery')await finish(current,'complete',current.cost_microusd+e.cost,'Published the approved community text without artwork after image generation failed.',null,{...publication,imagePrompt:null,altText:''});
    else await finish(current,'failed',current.cost_microusd+e.cost,e.httpStatus===400?'Artwork request rejected (HTTP 400). No image charge was recorded.':'Image generation could not complete. Known service costs were recorded.');
   }
   // A definite rejection means X created nothing, so no post or upload is charged.
   else if(definitiveX(e)&&(current.status==='posting'||current.status==='uploading'))await finish(current,'failed',current.cost_microusd,`X declined the ${current.status==='posting'?'post':'media upload'} (HTTP ${e.status}). Nothing was published.`);
   else await db().batch([
    db().prepare("UPDATE content_jobs SET status='uncertain',updated_at=? WHERE id=?").bind(Date.now(),job.id),
    db().prepare("INSERT INTO events(id,coin_id,owner,name,message,created_at) SELECT ?,id,owner,json_extract(config,'$.name'),'A publishing result is awaiting verification. No duplicate post will be sent.',? FROM coins WHERE id=? ON CONFLICT(id) DO NOTHING").bind('content-review:'+job.id,new Date().toISOString(),job.coin_id),
   ]);
  }
  return {processed:false,reason:'content_service_pending'};
 }
 return {processed:false};
}

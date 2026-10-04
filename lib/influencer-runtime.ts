import { sharedPersona } from "./agent-persona";
import { PERSONA_CONTEXT_RULES } from "./persona-policy";
import { providerHoldStatement } from './provider-holds';
import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { AppError, ProviderHttpError, db, type CoinRow } from './server';
import { chatPrice, callCeiling, chatCompletion, PaidCompletionRejected } from './chat-completion';
import { agentModel, GUARDRAIL_MODEL } from './agent-models';
import { xAccount, xConnected, xConfigured, xCosts, xMediaConfigured, xSession, revokeXSession } from './social-config';
import { xProvider, XAccessRevoked, XHttpFailure } from './x-official';
import { ProviderFailure } from './content-providers';
import { matchingTweet } from './content-policy';
import { contextBytes } from './planning-context';
import { influencerInput, influencerBrief, type InfluencerConfig } from './influencer-options';
import { INFLUENCER_SCRIPT_RULES, INFLUENCER_GUARD_RULES, influencerScript, captionProblem, masterPrompt, scenePrompt, influencerRates, type InfluencerRates, type InfluencerScript } from './influencer-policy';
import { higgsfieldCredentials, submitGeneration, generation, createCharacter, characterState, uploadMedia, downloadMedia, soulImage, videoModel, videoConfig, type VideoConfig, SOUL_PATH, HiggsfieldRejected } from './higgsfield';
import type { Coin } from './model';

type Influencer={coin_id:string;config:string;status:string;character_id:string|null;character_status:string|null;design_request:string|null;master_asset:string|null;master_url:string|null;reference_url:string|null;run_id:string|null;attempts:number;reserved_microusd:number;cost_microusd:number;next_attempt_at:number;next_post_at:number;last_error:string|null;created_at:number;updated_at:number};
type Post={id:string;coin_id:string;kind:'photo'|'video';status:string;caption:string;scene:string;motion:string;image_request:string|null;video_request:string|null;image_url:string|null;video_url:string|null;still_asset:string|null;user_id:string|null;media_id:string|null;tweet_id:string|null;reserved_microusd:number;cost_microusd:number;billing:string;attempts:number;posting_at:number|null;next_attempt_at:number;error:string|null;created_at:number;updated_at:number};
type Billing={script:number;guard:number;image:number;video:number;post:number;upload:number;read:number;videoConfig?:VideoConfig};
type Fence={sql:string;values:unknown[]};
const SCRIPT_TOKENS=900,GUARD_TOKENS=300,SCRIPT_BYTES=16000,IMAGE_BYTES=15000000,VIDEO_BYTES=100000000,WRITING_ALLOWANCE=100000;
const OPEN="('script','scripting','image_submit','image_wait','video_submit','video_wait','x_upload','uploading','x_processing','x_post','posting','uncertain','reconciling')";
const DUE="('script','image_submit','image_wait','video_submit','video_wait','x_upload','x_processing','x_post','uncertain')";
const PRE_POST=['script','image_submit','image_wait','video_submit','video_wait','x_upload','x_processing','x_post'];
const toBase64=(bytes:Uint8Array)=>{let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);};
const fromBase64=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const definitiveX=(error:unknown):error is XHttpFailure=>error instanceof XHttpFailure&&error.status>=400&&error.status<500&&error.status!==429&&error.status!==408;

export function influencerConfigured(){return !!higgsfieldCredentials()&&!!influencerRates()&&xConfigured()&&xMediaConfigured()&&!!env.OPENROUTER_API_KEY;}
// Estimated credit for the influencer's next spend, so the planner's service
// top-up covers it. Zero until X is connected and the character can proceed.
export async function influencerFunding(coinId:string){
 const rates=influencerRates();if(!rates||!influencerConfigured())return 0;
 const row=await db().prepare('SELECT status,run_id FROM influencers WHERE coin_id=?').bind(coinId).first<{status:string;run_id:string|null}>();
 if(!row||row.run_id)return 0;
 if(row.status==='awaiting_funds')return rates.character+rates.floor;
 if(row.status!=='active')return 0;
 try{const x=xCosts('');return rates.image+(videoConfig()&&rates.videoPercent>0?rates.video:0)+x.post+x.upload*2+x.read*3+WRITING_ALLOWANCE+rates.floor;}catch{return 0}
}

// Refund and settle a reservation exactly once. Every statement is fenced by
// the owning row's version, so a delayed worker cannot settle it twice.
function settleStatements(runId:string,coinId:string,reserved:number,cost:number,output:string,fence:Fence,unknownCost=0){
 if(!Number.isSafeInteger(cost)||cost<0||!Number.isSafeInteger(unknownCost)||unknownCost<0||cost+unknownCost>reserved)throw Error('Invalid influencer settlement');
 const charged=cost;
 return [
  ...(unknownCost?[providerHoldStatement(runId,coinId,unknownCost,fence)]:[]),
  db().prepare(`UPDATE coins SET ai_credit_microusd=ai_credit_microusd+? WHERE id=? AND EXISTS(SELECT 1 FROM agent_runs WHERE id=? AND coin_id=? AND status='reserved' AND reserved_microusd=?) AND ${fence.sql}`).bind(reserved-charged-unknownCost,coinId,runId,coinId,reserved,...fence.values),
  db().prepare(`UPDATE agent_runs SET status='settled',cost_microusd=?,output=?,finished_at=? WHERE id=? AND status='reserved' AND ${fence.sql}`).bind(charged,output.slice(0,1000),new Date().toISOString(),runId,...fence.values),
 ];
}

const POST_FIELDS=['kind','caption','scene','motion','image_request','video_request','image_url','video_url','still_asset','user_id','media_id','cost_microusd','attempts','error','posting_at'] as const;
type PostFields=Partial<Record<typeof POST_FIELDS[number],string|number|null>>;
async function movePost(post:Post,status:string,fields:PostFields={},delayMs=0,before:D1PreparedStatement[]=[]){
 const keys=(Object.keys(fields) as (typeof POST_FIELDS[number])[]).filter(k=>POST_FIELDS.includes(k));
 const version=Math.max(Date.now(),post.updated_at+1),next=Date.now()+delayMs;
 const results=await db().batch([...before,db().prepare(`UPDATE influencer_posts SET ${keys.map(k=>k+'=?,').join('')}status=?,next_attempt_at=?,updated_at=? WHERE id=? AND status=? AND updated_at=?`).bind(...keys.map(k=>fields[k]??null),status,next,version,post.id,post.status,post.updated_at)]);
 if(!results[results.length-1].meta.changes)return false;
 Object.assign(post,fields,{status,next_attempt_at:next,updated_at:version});return true;
}
const claimPost=(post:Post,status:string)=>movePost(post,status,{},90000);
async function deferPost(post:Post,delayMs:number){await db().prepare('UPDATE influencer_posts SET next_attempt_at=? WHERE id=? AND updated_at=?').bind(Date.now()+delayMs,post.id,post.updated_at).run();}
const postFence=(post:Post):Fence=>({sql:'EXISTS(SELECT 1 FROM influencer_posts WHERE id=? AND status=? AND updated_at=?)',values:[post.id,post.status,post.updated_at]});
async function finishPost(post:Post,status:'complete'|'failed',cost:number,message:string,tweetId:string|null=null,unknownCost=0){
 const version=Math.max(Date.now(),post.updated_at+1),charged=Math.max(0,Math.min(cost,post.reserved_microusd-unknownCost));
 await db().batch([
  ...settleStatements('influencer:'+post.id,post.coin_id,post.reserved_microusd,charged,message,postFence(post),unknownCost),
  db().prepare('UPDATE influencer_posts SET status=?,cost_microusd=?,tweet_id=COALESCE(?,tweet_id),error=?,updated_at=? WHERE id=? AND status=? AND updated_at=?').bind(status,charged,tweetId,status==='failed'?message.slice(0,300):null,version,post.id,post.status,post.updated_at),
  ...(status==='complete'?[db().prepare("INSERT INTO events(id,coin_id,owner,name,message,created_at) SELECT ?,id,owner,json_extract(config,'$.name'),?,? FROM coins WHERE id=? AND EXISTS(SELECT 1 FROM influencer_posts WHERE id=? AND status='complete' AND updated_at=?) ON CONFLICT(id) DO NOTHING").bind('influencer:'+post.id,message,new Date().toISOString(),post.coin_id,post.id,version)]:[]),
 ]);
 post.status=status;post.updated_at=version;
}

const INFLUENCER_FIELDS=['status','character_id','character_status','design_request','master_asset','master_url','reference_url','attempts','cost_microusd','next_attempt_at','next_post_at','last_error'] as const;
type InfluencerFields=Partial<Record<typeof INFLUENCER_FIELDS[number],string|number|null>>;
async function moveInfluencer(row:Influencer,fields:InfluencerFields,before:D1PreparedStatement[]=[]){
 const keys=(Object.keys(fields) as (typeof INFLUENCER_FIELDS[number])[]).filter(k=>INFLUENCER_FIELDS.includes(k));
 const version=Math.max(Date.now(),row.updated_at+1);
 const results=await db().batch([...before,db().prepare(`UPDATE influencers SET ${keys.map(k=>k+'=?,').join('')}updated_at=? WHERE coin_id=? AND updated_at=?`).bind(...keys.map(k=>fields[k]??null),version,row.coin_id,row.updated_at)]);
 if(!results[results.length-1].meta.changes)return false;
 Object.assign(row,fields,{updated_at:version});return true;
}
// Polls and waits move only next_attempt_at, so timeouts measured from
// updated_at (the last state change) keep counting.
async function deferInfluencer(row:Influencer,delayMs:number,lastError?:string){await db().prepare(`UPDATE influencers SET next_attempt_at=?${lastError===undefined?'':',last_error=?'} WHERE coin_id=? AND updated_at=?`).bind(...[Date.now()+delayMs,...(lastError===undefined?[]:[lastError]),row.coin_id,row.updated_at]).run();row.next_attempt_at=Date.now()+delayMs;}
const influencerFence=(row:Influencer):Fence=>({sql:'EXISTS(SELECT 1 FROM influencers WHERE coin_id=? AND updated_at=?)',values:[row.coin_id,row.updated_at]});
async function finishCharacter(row:Influencer,status:'active'|'failed',cost:number,message:string,unknownCost=0){
 const now=Date.now(),version=Math.max(now,row.updated_at+1),firstPost=now+300000+Math.floor(Math.random()*900000),charged=Math.max(0,Math.min(cost,row.reserved_microusd));
 await db().batch([
  ...settleStatements(row.run_id!,row.coin_id,row.reserved_microusd,charged,message,influencerFence(row),unknownCost),
  db().prepare('UPDATE influencers SET status=?,run_id=NULL,reserved_microusd=0,cost_microusd=?,design_request=NULL,last_error=?,next_post_at=?,next_attempt_at=?,updated_at=? WHERE coin_id=? AND updated_at=?').bind(status,charged,status==='failed'?message.slice(0,300):null,firstPost,status==='active'?firstPost:0,version,row.coin_id,row.updated_at),
  ...(status==='active'?[db().prepare("INSERT INTO events(id,coin_id,owner,name,message,created_at) SELECT ?,id,owner,json_extract(config,'$.name'),?,? FROM coins WHERE id=? AND EXISTS(SELECT 1 FROM influencers WHERE coin_id=? AND status='active' AND updated_at=?) ON CONFLICT(id) DO NOTHING").bind('influencer-ready:'+row.run_id,message,new Date(now).toISOString(),row.coin_id,row.coin_id,version)]:[]),
 ]);
 row.status=status;row.updated_at=version;return true;
}
async function retryCharacter(row:Influencer,message:string,fields:InfluencerFields){
 if(row.attempts+1>=3)return finishCharacter(row,'failed',row.cost_microusd,message);
 await moveInfluencer(row,{...fields,attempts:row.attempts+1,last_error:message,next_attempt_at:Date.now()+300000});return true;
}

async function characterReference(coinId:string){
 // A creator-supplied character wins; otherwise use the actual coin artwork,
 // not just its sampled palette. Existing trained characters remain unchanged.
 const reference=await db().prepare("SELECT mime,base64 FROM influencer_assets WHERE coin_id=? AND kind='reference' ORDER BY created_at DESC LIMIT 1").bind(coinId).first<{mime:'image/png'|'image/jpeg'|'image/webp';base64:string}>();
 return reference??await db().prepare('SELECT mime,base64 FROM coin_images WHERE coin_id=?').bind(coinId).first<{mime:'image/png'|'image/jpeg'|'image/webp';base64:string}>();
}

async function startCharacter(row:Influencer,coin:Coin,coinRow:CoinRow,rates:InfluencerRates){
 const now=Date.now();
 if(coin.state!=='active'||coinRow.ai_credit_microusd<rates.character+rates.floor){await moveInfluencer(row,{status:'awaiting_funds',last_error:null,next_attempt_at:now+600000});return true;}
 const runId='influencer:'+crypto.randomUUID(),reference=!!await characterReference(coin.id);
 const result=await db().batch([
  db().prepare("INSERT INTO agent_runs(id,coin_id,kind,status,reserved_microusd,created_at) SELECT ?,id,'influencer','reserved',?,? FROM coins WHERE id=? AND ai_credit_microusd>=? AND EXISTS(SELECT 1 FROM influencers WHERE coin_id=coins.id AND run_id IS NULL AND updated_at=?)").bind(runId,rates.character,new Date(now).toISOString(),coin.id,rates.character+rates.floor,row.updated_at),
  db().prepare("UPDATE coins SET ai_credit_microusd=ai_credit_microusd-? WHERE id=? AND EXISTS(SELECT 1 FROM agent_runs WHERE id=? AND status='reserved')").bind(rates.character,coin.id,runId),
  db().prepare("UPDATE influencers SET run_id=?,reserved_microusd=?,cost_microusd=0,attempts=0,status=?,last_error=NULL,next_attempt_at=0,updated_at=? WHERE coin_id=? AND run_id IS NULL AND updated_at=? AND EXISTS(SELECT 1 FROM agent_runs WHERE id=?)").bind(runId,rates.character,reference?'training':'designing',Math.max(now,row.updated_at+1),coin.id,row.updated_at,runId),
 ]);
 if(!result[0].meta.changes)await moveInfluencer(row,{status:'awaiting_funds',next_attempt_at:now+600000});
 return true;
}
// Identity first: a reference trains the character, then the master is drawn
// from it. Without one, the master is designed and becomes the training image.
async function characterStep(row:Influencer,coin:Coin,config:InfluencerConfig,rates:InfluencerRates){
 const now=Date.now(),brief=influencerBrief(config,coin),key=row.coin_id+':'+row.run_id+':'+row.attempts;
 // Custom-reference creation has no documented idempotency guarantee. A crash
 // after dispatch must not purchase a second identity with another POST.
 if(row.character_status==='submitting')return finishCharacter(row,'failed',row.cost_microusd,'Character creation needs provider verification; its remaining credit stays reserved separately.',row.reserved_microusd-row.cost_microusd);
 try{
  if(row.design_request){
   const result=await generation(row.design_request);
   if(result.status==='queued'||result.status==='in_progress'){if(now-row.updated_at>1800000){await deferInfluencer(row,60000,'Character design is still processing; other agent work continues.');return true;}await deferInfluencer(row,20000);return true;}
   if(result.status!=='completed'||!result.imageUrl)return retryCharacter(row,result.status==='nsfw'?'The image model declined the character brief. It will retry with a fresh design.':'Character design did not complete.',{design_request:null});
   let image;try{image=await downloadMedia(result.imageUrl,'image',IMAGE_BYTES);}catch(error){if(error instanceof HiggsfieldRejected)return retryCharacter(row,'The character design could not be saved.',{design_request:null,cost_microusd:row.cost_microusd+rates.image});throw error;}
   const asset=crypto.randomUUID(),fence=influencerFence(row);
   await moveInfluencer(row,{master_asset:asset,master_url:result.imageUrl,design_request:null,cost_microusd:row.cost_microusd+rates.image,next_attempt_at:0},[db().prepare(`INSERT INTO influencer_assets(id,coin_id,kind,mime,base64,created_at) SELECT ?,?,'master',?,?,? WHERE ${fence.sql}`).bind(asset,row.coin_id,image.mime,toBase64(image.bytes),now,...fence.values)]);
   return true;
  }
  if(row.character_id&&row.character_status!=='ready'){
   const state=await characterState(row.character_id);
   if(state==='training'){if(now-row.updated_at>3600000){await deferInfluencer(row,60000,'Character training is still processing; other agent work continues.');return true;}await deferInfluencer(row,30000);return true;}
   if(state==='failed')return retryCharacter(row,'Character training failed.',{character_id:null,character_status:null});
   await moveInfluencer(row,{character_status:'ready',next_attempt_at:0});return true;
  }
  if(row.character_id){
   if(row.master_asset)return finishCharacter(row,'active',Math.max(rates.character,row.cost_microusd),'AI influencer character created.');
   const request=await submitGeneration(SOUL_PATH,soulImage(masterPrompt(brief,config.notes),{characterId:row.character_id,aspect:'3:4'}),key+':master');
   await moveInfluencer(row,{design_request:request,status:'designing',next_attempt_at:now+20000});return true;
  }
  const reference=await characterReference(row.coin_id);
  if(reference&&!row.reference_url){await moveInfluencer(row,{reference_url:await uploadMedia(fromBase64(reference.base64),reference.mime),next_attempt_at:0});return true;}
  if(!reference&&!row.master_asset){
   const request=await submitGeneration(SOUL_PATH,soulImage(masterPrompt(brief,config.notes),{aspect:'3:4'}),key+':master');
   await moveInfluencer(row,{design_request:request,status:'designing',next_attempt_at:now+20000});return true;
  }
  const image=reference?row.reference_url:row.master_url;
  if(!image)return retryCharacter(row,'The character image is unavailable.',{master_asset:null,master_url:null});
  if(!await moveInfluencer(row,{character_status:'submitting',next_attempt_at:now+90000}))return false;
  let id:string;
  try{id=await createCharacter(coin.name+' influencer',[image],key+':character');}
  catch(error){
   if(error instanceof HiggsfieldRejected){await moveInfluencer(row,{character_status:null});throw error;}
   return finishCharacter(row,'failed',row.cost_microusd,'Character creation needs provider verification; its remaining credit stays reserved separately.',row.reserved_microusd-row.cost_microusd);
  }
  await moveInfluencer(row,{character_id:id,character_status:'training',status:'training',next_attempt_at:now+30000});return true;
 }catch(error){
  // The platform's Higgsfield account (credentials, credits, rate limit) is not
  // the character's fault: wait without spending one of its attempts.
  if(error instanceof HiggsfieldRejected&&[401,402,403,429].includes(error.status)){await deferInfluencer(row,1800000,'Higgsfield is temporarily unavailable for the platform.');return true;}
  if(error instanceof HiggsfieldRejected)return retryCharacter(row,`Higgsfield rejected the character request (HTTP ${error.status}).`,{design_request:null});
  // Unknown outcomes repeat with the same idempotency key on the next check.
  await deferInfluencer(row,60000);return true;
 }
}

async function schedulePost(row:Influencer,coin:Coin,coinRow:CoinRow,rates:InfluencerRates){
 const now=Date.now();
 if(row.next_post_at>now){await deferInfluencer(row,row.next_post_at-now);return false;}
 if(coin.state!=='active'){await moveInfluencer(row,{last_error:'Waiting for the agent treasury to activate.',next_attempt_at:now+600000});return true;}
 if(await db().prepare(`SELECT id FROM influencer_posts WHERE coin_id=? AND status IN ${OPEN} LIMIT 1`).bind(coin.id).first()){await deferInfluencer(row,300000);return false;}
 let prices;try{prices=await Promise.all([chatPrice(agentModel(coin.modelId).id),chatPrice(GUARDRAIL_MODEL)]);}catch{await moveInfluencer(row,{last_error:'Writing model pricing is unavailable.',next_attempt_at:now+900000});return true;}
 const x=xCosts(''),selectedVideo=videoConfig(),kind:'photo'|'video'=selectedVideo&&rates.video>0&&Math.random()*100<rates.videoPercent?'video':'photo';
 const billing:Billing={script:callCeiling(prices[0],SCRIPT_TOKENS,SCRIPT_BYTES),guard:callCeiling(prices[1],GUARD_TOKENS,SCRIPT_BYTES),image:rates.image,video:kind==='video'?rates.video:0,post:x.post,upload:x.upload,read:x.read,...(kind==='video'&&selectedVideo?{videoConfig:selectedVideo}:{})};
 const reserve=billing.script+billing.guard+billing.image+billing.video+billing.post+billing.upload*2+billing.read*3;
 if(coinRow.ai_credit_microusd<reserve+rates.floor){await moveInfluencer(row,{last_error:'Waiting for service credit.',next_attempt_at:now+900000});return true;}
 try{if(await xProvider(env.X_API_BEARER_TOKEN!).balance()<x.post+x.upload+x.read*3){await moveInfluencer(row,{last_error:'Platform X credit needs replenishing.',next_attempt_at:now+1800000});return true;}}
 catch{await moveInfluencer(row,{next_attempt_at:now+900000});return true;}
 const id=crypto.randomUUID(),runId='influencer:'+id,next=now+Math.round(86400000/rates.dailyPosts*(.75+Math.random()*.5));
 // One open post per coin, and a quiet half hour after the agent's own updates.
 const result=await db().batch([
  db().prepare(`INSERT INTO influencer_posts(id,coin_id,kind,status,reserved_microusd,billing,created_at,updated_at,next_attempt_at) SELECT ?,id,?,'script',?,?,?,?,0 FROM coins WHERE id=? AND token_address IS NOT NULL AND ai_credit_microusd>=?
   AND NOT EXISTS(SELECT 1 FROM influencer_posts WHERE coin_id=coins.id AND status IN ${OPEN})
   AND NOT EXISTS(SELECT 1 FROM content_jobs WHERE coin_id=coins.id AND created_at>?)
   AND EXISTS(SELECT 1 FROM influencers WHERE coin_id=coins.id AND status='active' AND run_id IS NULL AND updated_at=?)`).bind(id,kind,reserve,JSON.stringify(billing),now,now,coin.id,reserve+rates.floor,now-1800000,row.updated_at),
  db().prepare("INSERT INTO agent_runs(id,coin_id,kind,status,reserved_microusd,created_at) SELECT ?,coin_id,'influencer','reserved',reserved_microusd,? FROM influencer_posts WHERE id=?").bind(runId,new Date(now).toISOString(),id),
  db().prepare("UPDATE coins SET ai_credit_microusd=ai_credit_microusd-? WHERE id=? AND EXISTS(SELECT 1 FROM agent_runs WHERE id=? AND status='reserved')").bind(reserve,coin.id,runId),
  db().prepare("UPDATE influencers SET next_post_at=?,next_attempt_at=?,last_error=NULL,updated_at=? WHERE coin_id=? AND updated_at=? AND EXISTS(SELECT 1 FROM influencer_posts WHERE id=?)").bind(next,next,Math.max(now,row.updated_at+1),coin.id,row.updated_at,id),
 ]);
 if(!result[0].meta.changes){await moveInfluencer(row,{next_attempt_at:now+1800000});return false;}
 return true;
}

async function writePost(post:Post,coin:Coin,billing:Billing){
 const influencer=await db().prepare('SELECT * FROM influencers WHERE coin_id=?').bind(post.coin_id).first<Influencer>();
 if(influencer?.status!=='active'||!influencer.character_id){await finishPost(post,'failed',0,'The character is not ready.');return true;}
 const config=influencerInput.parse(JSON.parse(influencer.config));
 const [price,guardPrice]=await Promise.all([chatPrice(agentModel(coin.modelId).id),chatPrice(GUARDRAIL_MODEL)]);
 if(callCeiling(price,SCRIPT_TOKENS,SCRIPT_BYTES)>billing.script||callCeiling(guardPrice,GUARD_TOKENS,SCRIPT_BYTES)>billing.guard){await finishPost(post,'failed',0,'Writing model pricing changed; this post was skipped.');return true;}
 if(!await claimPost(post,'scripting'))return false;
 const [recent,updates]=await Promise.all([
  db().prepare("SELECT caption FROM influencer_posts WHERE coin_id=? AND status='complete' ORDER BY created_at DESC LIMIT 6").bind(coin.id).all<{caption:string}>(),
  db().prepare("SELECT kind,created_at FROM agent_operations WHERE coin_id=? AND status='confirmed' ORDER BY created_at DESC LIMIT 3").bind(coin.id).all<{kind:string;created_at:number}>(),
 ]);
 const system=PERSONA_CONTEXT_RULES+INFLUENCER_SCRIPT_RULES+'Write the caption in '+(coin.language==='zh'?'Simplified Chinese.':'English.');
 const context={persona:await sharedPersona(coin),format:post.kind,timeUtc:new Date().toISOString(),character:{brief:influencerBrief(config,coin),notes:config.notes},coin:{name:coin.name,symbol:coin.symbol,story:coin.description.slice(0,600),mission:(coin.purpose??'').slice(0,600),voice:(coin.personality??'').slice(0,300),focus:(coin.focus??'').slice(0,300)},verifiedUpdates:updates.results.map(u=>({kind:u.kind,status:'confirmed',at:new Date(Number(u.created_at)).toISOString()})),recentCaptions:recent.results.map(r=>r.caption)};
 while(context.recentCaptions.length&&contextBytes(system,context)>SCRIPT_BYTES-500)context.recentCaptions.pop();
 const audit={coinId:coin.id,runId:'influencer:'+post.id};
 let cost=0;
 const fail=async(message:string,extra=0,held=0)=>{await finishPost(post,'failed',cost+extra,message,null,held);return true;};
 // A dispatched call with no verified receipt is charged its reserved ceiling.
 const unknownCost=(error:unknown,ceiling:number)=>error instanceof PaidCompletionRejected?error.cost:(error instanceof ProviderHttpError&&error.providerStatus>=400&&error.providerStatus<500&&error.providerStatus!==408)||(error instanceof AppError&&(error.status===412||error.status===413))?0:ceiling;
 let draft:string;
 try{const r=await chatCompletion(price,system,context,SCRIPT_TOKENS,SCRIPT_BYTES,{...audit,kind:'influencer'});cost+=r.cost;draft=r.text;}catch(error){return fail('The post could not be written.',error instanceof PaidCompletionRejected?error.cost:0,error instanceof PaidCompletionRejected?0:unknownCost(error,billing.script));}
 let script:InfluencerScript;
 try{script=influencerScript.parse(JSON.parse(draft));}catch{return fail('The written post was not valid.');}
 if(post.kind==='photo')script={...script,motion:null};
 const problem=captionProblem(script.caption,coin.symbol);if(problem)return fail(problem);
 let review:string;
 try{const r=await chatCompletion(guardPrice,INFLUENCER_GUARD_RULES,{post:script,format:post.kind,coin:{name:coin.name,symbol:coin.symbol},verifiedUpdates:context.verifiedUpdates},GUARD_TOKENS,SCRIPT_BYTES,{...audit,kind:'influencer-guard'});cost+=r.cost;review=r.text;}catch(error){return fail('The independent review could not complete.',error instanceof PaidCompletionRejected?error.cost:0,error instanceof PaidCompletionRejected?0:unknownCost(error,billing.guard));}
 const verdict=z.object({allow:z.boolean(),reason:z.string().max(1000)}).strict().safeParse((()=>{try{return JSON.parse(review)}catch{return null}})());
 if(!verdict.success)return fail('The independent review returned an invalid verdict.');
 if(!verdict.data.allow)return fail('The independent review declined this post.');
 await movePost(post,'image_submit',{caption:script.caption,scene:script.scene,motion:script.motion??'',cost_microusd:cost});return true;
}
async function submitImage(post:Post,coin:Coin){
 const influencer=await db().prepare('SELECT config,character_id FROM influencers WHERE coin_id=?').bind(post.coin_id).first<{config:string;character_id:string|null}>();
 if(!influencer?.character_id){await finishPost(post,'failed',post.cost_microusd,'The character is not ready.');return true;}
 const prompt=scenePrompt(influencerBrief(influencerInput.parse(JSON.parse(influencer.config)),coin),post.scene,post.kind);
 const request=await submitGeneration(SOUL_PATH,soulImage(prompt,{characterId:influencer.character_id,aspect:post.kind==='video'?'9:16':'3:4'}),post.id+':image');
 await movePost(post,'image_wait',{image_request:request},20000);return true;
}
async function awaitImage(post:Post,billing:Billing){
 const result=await generation(post.image_request!);
 if(result.status==='queued'||result.status==='in_progress'){if(Date.now()-post.updated_at>1800000){await finishPost(post,'failed',post.cost_microusd,'Image generation is unverified; its credit stays reserved separately.',null,billing.image);return true;}await deferPost(post,15000);return false;}
 if(result.status!=='completed'||!result.imageUrl){await finishPost(post,'failed',post.cost_microusd,result.status==='nsfw'?'The image model declined this scene.':'Image generation did not complete.');return true;}
 let image;try{image=await downloadMedia(result.imageUrl,'image',IMAGE_BYTES);}catch(error){if(error instanceof HiggsfieldRejected){await finishPost(post,'failed',post.cost_microusd+billing.image,'The generated image could not be used.');return true;}throw error;}
 const asset=crypto.randomUUID(),fence=postFence(post);
 await movePost(post,post.kind==='video'?'video_submit':'x_upload',{image_url:result.imageUrl,still_asset:asset,cost_microusd:post.cost_microusd+billing.image},0,[db().prepare(`INSERT INTO influencer_assets(id,coin_id,kind,mime,base64,created_at) SELECT ?,?,'still',?,?,? WHERE ${fence.sql}`).bind(asset,post.coin_id,image.mime,toBase64(image.bytes),Date.now(),...fence.values)]);
 return true;
}
async function submitVideo(post:Post){
 const billing=JSON.parse(post.billing) as Billing;
 // Older jobs did not snapshot their model. Finish as a photo rather than
 // buying a newly selected provider against an old provider's reservation.
 if(!billing.videoConfig){await movePost(post,'x_upload',{kind:'photo'});return true;}
 const model=videoModel(billing.videoConfig);
 const request=await submitGeneration(model.path,model.body(post.image_url!,post.motion||'Subtle natural motion with a gentle camera push-in.'),post.id+':video');
 await movePost(post,'video_wait',{video_request:request},30000);return true;
}
async function awaitVideo(post:Post,billing:Billing){
 const result=await generation(post.video_request!);
 if(result.status==='queued'||result.status==='in_progress'){if(Date.now()-post.updated_at>2700000){await deferPost(post,60000);return false;}await deferPost(post,20000);return false;}
 // A failed or declined clip falls back to the finished photo without a video charge.
 if(result.status==='completed'&&result.videoUrl)await movePost(post,'x_upload',{video_url:result.videoUrl,cost_microusd:post.cost_microusd+billing.video});
 else await movePost(post,'x_upload',{kind:'photo'});
 return true;
}
async function publishStep(post:Post,coin:Coin,billing:Billing){
 const account=await xAccount(coin.id);
 if(!account||!xConnected(account)||(post.user_id&&account.user_id!==post.user_id)){await finishPost(post,'failed',post.cost_microusd,'The X account was disconnected before publication.');return true;}
 const session=await xSession(account),provider=xProvider(env.X_API_BEARER_TOKEN!);
 if(post.status==='x_processing'){
  const media=await provider.mediaStatus(session,post.media_id!);
  if(media.state==='succeeded'){await movePost(post,'x_post');return true;}
  if(media.state==='failed'||Date.now()-post.updated_at>1200000){await finishPost(post,'failed',post.cost_microusd,'X could not process the video.');return true;}
  await deferPost(post,media.checkAfterMs);return false;
 }
 if(post.status==='x_upload'){
  if(post.attempts>=2){await finishPost(post,'failed',post.cost_microusd,'Media upload to X did not complete.');return true;}
  if(await provider.balance()<billing.post+billing.upload+billing.read*3){await deferPost(post,600000);return false;}
  let file:{bytes:Uint8Array<ArrayBuffer>;mime:string};
  if(post.kind==='video'){
   try{file=await downloadMedia(post.video_url!,'video',VIDEO_BYTES);}catch(error){if(error instanceof HiggsfieldRejected){await movePost(post,'x_upload',{kind:'photo'});return true;}throw error;}
  }else{
   const asset=await db().prepare('SELECT mime,base64 FROM influencer_assets WHERE id=? AND coin_id=?').bind(post.still_asset,post.coin_id).first<{mime:string;base64:string}>();
   if(!asset){await finishPost(post,'failed',post.cost_microusd,'The generated image is unavailable.');return true;}
   file={bytes:fromBase64(asset.base64),mime:asset.mime};
  }
  if(!await claimPost(post,'uploading'))return false;
  const charged=post.cost_microusd+billing.upload;
  if(post.kind==='video'){
   const media=await provider.uploadVideo(session,file.bytes);
   if(media.state==='failed'){await finishPost(post,'failed',charged,'X could not process the video.');return true;}
   await movePost(post,media.state==='succeeded'?'x_post':'x_processing',{media_id:media.mediaId,user_id:account.user_id,cost_microusd:charged},media.checkAfterMs);return true;
  }
  const mediaId=await provider.upload(session,new File([file.bytes],'influencer.'+file.mime.split('/')[1],{type:file.mime}));
  if(!/^\d+$/.test(mediaId))throw new ProviderFailure();
  await movePost(post,'x_post',{media_id:mediaId,user_id:account.user_id,cost_microusd:charged});return true;
 }
 // One conditional claim precedes the only network write that publishes.
 if(await provider.balance()<billing.post+billing.read*3){await deferPost(post,600000);return false;}
 // posting_at is written with the claim, so a crash cannot leave it unset.
 if(!await movePost(post,'posting',{posting_at:Date.now()},90000))return false;
 const tweetId=await provider.post(session,post.caption,post.media_id);
 if(!/^\d+$/.test(tweetId))throw new ProviderFailure();
 await db().prepare('UPDATE influencer_posts SET tweet_id=? WHERE id=?').bind(tweetId,post.id).run();
 await finishPost(post,'complete',post.cost_microusd+billing.post,'AI influencer posted on X: https://x.com/i/status/'+tweetId,tweetId);return true;
}
// A lost reply is matched by account, exact text, media and time. After three
// unmatched reads it stops retrying; unverified credit remains held separately.
async function reconcilePost(post:Post,coin:Coin,billing:Billing){
 if(post.attempts>=3){await finishPost(post,'failed',post.cost_microusd,'X did not confirm this post. Its possible charge stays reserved separately; it will not be resent.',null,billing.post);return true;}
 const account=await xAccount(coin.id);
 if(!account||!post.user_id||account.user_id!==post.user_id||!xConnected(account)){
  if(Date.now()-post.updated_at>3600000){await finishPost(post,'failed',post.cost_microusd,'The X account disconnected before this post could be verified. Its possible charge stays reserved separately.',null,billing.post);return true;}
  await deferPost(post,600000);return false;
 }
 const session=await xSession(account),provider=xProvider(env.X_API_BEARER_TOKEN!);
 if(await provider.balance()<billing.read){await deferPost(post,600000);return false;}
 if(!await claimPost(post,'reconciling'))return false;
 const tweets=await provider.tweets(session,post.user_id),cost=post.cost_microusd+Math.min(tweets.length*5000,billing.read);
 const match=matchingTweet(tweets,{userId:post.user_id,text:post.caption,startedAt:post.posting_at??post.updated_at,mediaId:post.media_id});
 if(match){await finishPost(post,'complete',cost+billing.post,'AI influencer posted on X: https://x.com/i/status/'+match,match);return true;}
 await movePost(post,'uncertain',{attempts:post.attempts+1,cost_microusd:cost},60000);return true;
}
async function postError(post:Post,error:unknown,billing:Billing){
 if(error instanceof XAccessRevoked){const account=await xAccount(post.coin_id);if(account)await revokeXSession(account);}
 const current=await db().prepare('SELECT * FROM influencer_posts WHERE id=?').bind(post.id).first<Post>();if(!current)return false;
 // Network writes with an unknown outcome are never repeated automatically.
 if(current.status==='posting'){
  if(definitiveX(error))await finishPost(current,'failed',current.cost_microusd,`X declined the post (HTTP ${error.status}).`);
  else await movePost(current,'uncertain',{attempts:0},60000);
  return true;
 }
 if(current.status==='uploading'){
  if(definitiveX(error))await finishPost(current,'failed',current.cost_microusd,`X declined the media upload (HTTP ${error.status}).`);
  else await finishPost(current,'failed',current.cost_microusd,'The media upload result is unverified; its possible charge stays reserved separately.',null,billing.upload);
  return true;
 }
 if(current.status==='reconciling'){await movePost(current,'uncertain',{},60000);return true;}
 if(error instanceof HiggsfieldRejected){
  if(current.status==='video_submit'&&current.still_asset){await movePost(current,'x_upload',{kind:'photo'});return true;}
  await finishPost(current,'failed',current.cost_microusd,`Higgsfield rejected the request (HTTP ${error.status}).`);return true;
 }
 if(error instanceof AppError&&error.status===412){await finishPost(current,'failed',current.cost_microusd,'The X account needs to be reconnected.');return true;}
 // Pending provider results, rate limits and token refreshes retry later;
 // the six-hour expiry bounds every pre-publication stage.
 await deferPost(current,60000);return false;
}
async function stepPost(post:Post){
 const coinRow=await db().prepare('SELECT * FROM coins WHERE id=? AND token_address IS NOT NULL').bind(post.coin_id).first<CoinRow>();if(!coinRow)return false;
 const coin=JSON.parse(coinRow.config) as Coin,billing=JSON.parse(post.billing) as Billing;
 if(Date.now()-post.created_at>21600000&&PRE_POST.includes(post.status)){await finishPost(post,'failed',post.cost_microusd,'The post expired before publication. Any pending generation credit remains reserved.',null,['image_wait','image_submit'].includes(post.status)?billing.image:['video_wait','video_submit'].includes(post.status)?billing.video:0);return true;}
 try{
  if(post.status==='script')return await writePost(post,coin,billing);
  if(post.status==='image_submit')return await submitImage(post,coin);
  if(post.status==='image_wait')return await awaitImage(post,billing);
  if(post.status==='video_submit')return await submitVideo(post);
  if(post.status==='video_wait')return await awaitVideo(post,billing);
  if(post.status==='uncertain')return await reconcilePost(post,coin,billing);
  return await publishStep(post,coin,billing);
 }catch(error){return postError(post,error,billing);}
}
async function stepInfluencer(row:Influencer,rates:InfluencerRates){
 const coinRow=await db().prepare('SELECT * FROM coins WHERE id=? AND token_address IS NOT NULL').bind(row.coin_id).first<CoinRow>();if(!coinRow)return false;
 const coin=JSON.parse(coinRow.config) as Coin,config=influencerInput.safeParse(JSON.parse(row.config));
 if(!config.success){await moveInfluencer(row,{status:'failed',last_error:'The saved character settings are invalid.'});return true;}
 // Designing waits for X: the connected account is the character's identity.
 if(!row.run_id&&!xConnected(await xAccount(coin.id))){await moveInfluencer(row,{status:'awaiting_x',next_attempt_at:Date.now()+300000});return true;}
 if(row.status==='active')return schedulePost(row,coin,coinRow,rates);
 if(!row.run_id)return startCharacter(row,coin,coinRow,rates);
 return characterStep(row,coin,config.data,rates);
}
async function recoverStale(now:number){
 await db().prepare("UPDATE influencer_posts SET status='uncertain',attempts=0,next_attempt_at=0,updated_at=? WHERE status='posting' AND updated_at<?").bind(now,now-300000).run();
 await db().prepare("UPDATE influencer_posts SET status='uncertain',next_attempt_at=0,updated_at=? WHERE status='reconciling' AND updated_at<?").bind(now,now-300000).run();
 const uploads=await db().prepare("SELECT * FROM influencer_posts WHERE status='uploading' AND updated_at<? LIMIT 5").bind(now-300000).all<Post>();
 for(const post of uploads.results){const billing=JSON.parse(post.billing) as Billing;await finishPost(post,'failed',post.cost_microusd,'Media upload was interrupted; its possible charge stays reserved separately.',null,billing.upload);}
 const stuck=await db().prepare("SELECT * FROM influencer_posts WHERE status='scripting' AND updated_at<? LIMIT 5").bind(now-300000).all<Post>();
 for(const post of stuck.results){const billing=JSON.parse(post.billing) as Billing;await finishPost(post,'failed',post.cost_microusd,'Writing was interrupted; its unverified cost stays reserved separately.',null,billing.script+billing.guard);}
}
async function duePost(now:number){
 const post=await db().prepare(`SELECT p.* FROM influencer_posts p JOIN coins c ON c.id=p.coin_id WHERE c.token_address IS NOT NULL AND p.status IN ${DUE} AND p.next_attempt_at<=? ORDER BY p.next_attempt_at,p.created_at LIMIT 1`).bind(now).first<Post>();
 if(!post)return null;
 const turn=await db().prepare('UPDATE influencer_posts SET next_attempt_at=? WHERE id=? AND next_attempt_at=?').bind(now+90000,post.id,post.next_attempt_at).run();
 if(!turn.meta.changes)return null;
 post.next_attempt_at=now+90000;return post;
}
async function dueInfluencer(now:number){
 const row=await db().prepare("SELECT i.* FROM influencers i JOIN coins c ON c.id=i.coin_id WHERE c.token_address IS NOT NULL AND i.status!='failed' AND i.next_attempt_at<=? ORDER BY i.next_attempt_at,i.coin_id LIMIT 1").bind(now).first<Influencer>();
 if(!row)return null;
 const turn=await db().prepare('UPDATE influencers SET next_attempt_at=? WHERE coin_id=? AND next_attempt_at=?').bind(now+90000,row.coin_id,row.next_attempt_at).run();
 if(!turn.meta.changes)return null;
 row.next_attempt_at=now+90000;return row;
}
export async function runInfluencerTick(capabilities:string[]){
 const rates=influencerRates();
 if(!capabilities.includes('influencer-media')||!rates)return {processed:0,reason:'influencer_unavailable'};
 const started=Date.now();let processed=0;
 await recoverStale(started);
 for(let i=0;i<10&&Date.now()-started<60000;i++){const post=await duePost(Date.now());if(!post)break;try{if(await stepPost(post))processed++;}catch(error){console.warn('[SHEN influencer] post step failed',error instanceof Error?error.name:'unknown');}}
 for(let i=0;i<10&&Date.now()-started<90000;i++){const row=await dueInfluencer(Date.now());if(!row)break;try{if(await stepInfluencer(row,rates))processed++;}catch(error){console.warn('[SHEN influencer] character step failed',error instanceof Error?error.name:'unknown');}}
 return {processed};
}

// Public projection: no provider IDs, URLs, credentials or internal errors.
export async function influencerStatus(coin:{id:string;name:string;symbol:string;tokenAddress?:string},owner:boolean){
 const row=await db().prepare('SELECT status,config,master_asset,next_post_at,last_error FROM influencers WHERE coin_id=?').bind(coin.id).first<{status:string;config:string;master_asset:string|null;next_post_at:number;last_error:string|null}>();
 if(!row)return {enabled:false as const};
 const [posts,account,reference]=await Promise.all([
  db().prepare('SELECT id,kind,status,caption,still_asset,tweet_id,created_at FROM influencer_posts WHERE coin_id=? ORDER BY created_at DESC LIMIT 24').bind(coin.id).all<{id:string;kind:string;status:string;caption:string;still_asset:string|null;tweet_id:string|null;created_at:number}>(),
  xAccount(coin.id),
  owner?db().prepare("SELECT id FROM influencer_assets WHERE coin_id=? AND kind='reference' ORDER BY created_at DESC LIMIT 1").bind(coin.id).first<{id:string}>():Promise.resolve(null),
 ]);
 const config=influencerInput.parse(JSON.parse(row.config)),asset=(id:string)=>`/api/coins/${encodeURIComponent(coin.id)}/influencer/assets/${encodeURIComponent(id)}`;
 const status=!coin.tokenAddress?'pending_launch':!influencerConfigured()?'unavailable':row.status==='pending_launch'?'awaiting_x':row.status;
 return {enabled:true as const,status,brief:influencerBrief(config,coin),config,characterImageUrl:row.master_asset?asset(row.master_asset):null,referenceImageUrl:reference?asset(reference.id):null,xUsername:account?.username??null,xConnected:xConnected(account),nextPostAt:row.status==='active'?row.next_post_at:null,notice:['awaiting_funds','active','failed'].includes(row.status)?row.last_error:null,
  posts:posts.results.filter(p=>p.status!=='failed').map(p=>{const done=p.status==='complete';return {id:p.id,kind:p.kind,status:done?'complete':'creating',caption:done?p.caption:null,imageUrl:done&&p.still_asset?asset(p.still_asset):null,tweetUrl:done&&p.tweet_id&&/^\d+$/.test(p.tweet_id)?'https://x.com/i/status/'+p.tweet_id:null,createdAt:p.created_at};})};
}

import { env } from 'cloudflare:workers';
import { validSecretKey, openServiceSecret, sealServiceSecret } from '../shared/service-secrets.mjs';
import { db, AppError } from './server';
import { exchangeXToken, type XTokens } from './x-official';
import { XConnectionError } from './x-connection-result';
import twitterText from 'twitter-text';
export function xConfigured(){return !!env.X_CLIENT_ID&&!!env.X_CLIENT_SECRET&&!!env.X_API_BEARER_TOKEN&&validSecretKey(env.SERVICE_CREDENTIALS_KEY)}
export function xCosts(text=''){
 const post=Number(twitterText.extractUrls(text).length?env.X_POST_URL_COST_MICROUSD??200000:env.X_POST_COST_MICROUSD??15000),upload=Number(env.X_UPLOAD_COST_MICROUSD??0),read=Number(env.X_READ_COST_MICROUSD??50000);
 if([post,read].some(v=>!Number.isSafeInteger(v)||v<1||v>1000000)||!Number.isSafeInteger(upload)||upload<0||upload>1000000)throw Error('Invalid X billing rates');
 return {post,upload,read};
}
export function xMediaConfigured(){return env.X_UPLOAD_COST_MICROUSD!==undefined&&env.X_UPLOAD_COST_MICROUSD!==''}
export type XAccount={coin_id:string;user_id:string;username:string;encrypted_session:string;version:string;auth_type:string;reconnect_required:number;refresh_status:string;updated_at:number};
export function xConnected(account:XAccount|null){return !!account&&account.auth_type==='oauth2'&&!account.reconnect_required}
export function xAccount(coinId:string){return db().prepare('SELECT * FROM x_accounts WHERE coin_id=?').bind(coinId).first<XAccount>()}
export async function revokeXSession(account:XAccount){await db().prepare("UPDATE x_accounts SET reconnect_required=1,refresh_status='idle' WHERE coin_id=? AND version=?").bind(account.coin_id,account.version).run()}
export async function xSession(account:XAccount):Promise<XTokens>{
 if(!xConnected(account))throw new AppError(412,'Reconnect this account with X.');
 if(account.refresh_status==='refreshing'){
  if(Date.now()-account.updated_at>120000)await revokeXSession(account);
  throw new AppError(409,'Account access is refreshing or needs reconnection.');
 }
 const tokens=await openServiceSecret(env.SERVICE_CREDENTIALS_KEY,account.coin_id+':'+account.user_id+':'+account.version,account.encrypted_session) as XTokens;
 if(tokens.expiresAt>Date.now()+120000)return tokens;
 const claim=await db().prepare("UPDATE x_accounts SET refresh_status='refreshing',updated_at=? WHERE coin_id=? AND version=? AND refresh_status='idle' AND reconnect_required=0").bind(Date.now(),account.coin_id,account.version).run();
 if(!claim.meta.changes)throw new AppError(409,'Another request is refreshing X access.');
 try{
  const refreshed=await exchangeXToken(env.X_CLIENT_ID!,env.X_CLIENT_SECRET!,{grant_type:'refresh_token',refresh_token:tokens.refreshToken});
  const version=crypto.randomUUID(),encrypted=await sealServiceSecret(env.SERVICE_CREDENTIALS_KEY,account.coin_id+':'+account.user_id+':'+version,refreshed);
  const saved=await db().prepare("UPDATE x_accounts SET encrypted_session=?,version=?,refresh_status='idle',updated_at=? WHERE coin_id=? AND version=? AND refresh_status='refreshing'").bind(encrypted,version,Date.now(),account.coin_id,account.version).run();
  if(!saved.meta.changes)throw new AppError(409,'X connection changed during refresh.');
  account.version=version;return refreshed;
 }catch(error){
  // A rejected client or a rate limit happens before X spends the single-use
  // refresh token, so the connection stays valid and the refresh retries later.
  if(error instanceof XConnectionError&&(error.code==='oauth_client'||error.code==='rate_limited')){
   await db().prepare("UPDATE x_accounts SET refresh_status='idle',updated_at=? WHERE coin_id=? AND version=? AND refresh_status='refreshing'").bind(Date.now(),account.coin_id,account.version).run();
   throw new AppError(409,'X access could not be refreshed right now. It will retry.');
  }
  await revokeXSession(account);throw new AppError(412,'Reconnect this account with X.');
 }
}

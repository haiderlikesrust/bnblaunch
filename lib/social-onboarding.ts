import { env } from 'cloudflare:workers';
import { sealServiceSecret, openServiceSecret } from '../shared/service-secrets.mjs';
import { AppError, db } from './server';
import { digest } from './auth';
import { xProvider, exchangeXToken, X_SCOPES, XHttpFailure } from './x-official';
import { XConnectionError } from './x-connection-result';
import { xAccount, xConfigured, xConnected } from './social-config';
export const X_OAUTH_COOKIE='shen_x_oauth';
export function xCallbackUrl(){if(!env.APP_ORIGIN)throw new AppError(503,'Set the public site origin.');const origin=new URL(env.APP_ORIGIN);if(origin.protocol!=='https:'||origin.username||origin.password)throw new AppError(503,'X connection requires an HTTPS site.');return origin.origin+'/api/social/x/callback'}
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32))).map(v=>v.toString(16).padStart(2,'0')).join('');
export async function socialStatus(coinId:string){const account=await xAccount(coinId);return {configured:xConfigured(),connected:xConnected(account),username:account?.username??null,reconnectRequired:!!account&&(!xConnected(account)||(account.refresh_status==='refreshing'&&Date.now()-account.updated_at>120000))};}
export async function beginXConnection(coinId:string,owner:string){
 let stage:'configuration'|'encryption'|'credit-check'|'storage'='configuration';
 try{
 if(!xConfigured())throw new AppError(503,'X account setup is not available yet.');
 const redirectUri=xCallbackUrl(),now=Date.now(),state=randomToken(),id=await digest(state),verifier=randomToken();
 const challengeBytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
 const challenge=btoa(String.fromCharCode(...challengeBytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
 stage='encryption';
 const encrypted=await sealServiceSecret(env.SERVICE_CREDENTIALS_KEY,'x-oauth:'+id+':'+owner,{verifier});
 const limit=Number(env.X_LOGIN_DAILY_LIMIT_MICROUSD??1000000),cost=10000;
 if(!Number.isSafeInteger(limit)||limit<cost)throw new AppError(503,'X connection allowance is unavailable.');
 stage='storage';
 // Allowances are checked before any paid X call, so spam cannot exhaust the
 // platform's X credit or rate limit for everyone else.
 const recent=await db().prepare("SELECT (SELECT COUNT(*) FROM x_oauth_attempts WHERE owner=? AND created_at>?) AS hour,(SELECT COUNT(*) FROM x_oauth_attempts WHERE owner=? AND created_at>?) AS day,(SELECT COUNT(*) FROM x_oauth_attempts WHERE created_at>?) AS total").bind(owner,now-3600000,owner,now-86400000,now-86400000).first<{hour:number;day:number;total:number}>();
 if(Number(recent?.hour)>=3||Number(recent?.day)>=10||Number(recent?.total)*cost+cost>limit)throw new AppError(429,'The X connection allowance has been reached. Try later.');
 stage='credit-check';
 if(await xProvider(env.X_API_BEARER_TOKEN!).balance()<cost)throw new AppError(503,'X API credit needs replenishing.');
 stage='storage';
 await db().prepare("UPDATE x_oauth_attempts SET encrypted_verifier='',status='expired' WHERE expires_at<? AND status IN ('pending','exchanging')").bind(now).run();
 const saved=await db().prepare("INSERT INTO x_oauth_attempts(id,coin_id,owner,encrypted_verifier,status,created_at,expires_at) SELECT ?,?,?,?,'pending',?,? WHERE (SELECT COUNT(*) FROM x_oauth_attempts WHERE owner=? AND created_at>?)<3 AND (SELECT COUNT(*) FROM x_oauth_attempts WHERE owner=? AND created_at>?)<10 AND (SELECT COUNT(*) FROM x_oauth_attempts WHERE created_at>?)*?+?<=?").bind(id,coinId,owner,encrypted,now,now+600000,owner,now-3600000,owner,now-86400000,now-86400000,cost,cost,limit).run();
 if(!saved.meta.changes)throw new AppError(429,'The X connection allowance has been reached. Try later.');
 const params=new URLSearchParams({response_type:'code',client_id:env.X_CLIENT_ID!,redirect_uri:redirectUri,scope:X_SCOPES.join(' '),state,code_challenge:challenge,code_challenge_method:'S256'});
 return {state,url:'https://x.com/i/oauth2/authorize?'+params};
 }catch(error){
  if(error instanceof AppError)throw error;
  const status=error instanceof XHttpFailure?error.status:null;
  // Log only stage/status, never credentials, OAuth state, or database values.
  console.warn('[SHEN X connection start]',stage,status??'failed');
  if(stage==='credit-check'){
   if(status===401)throw new AppError(503,'X rejected the application Bearer Token. Check X_API_BEARER_TOKEN in the web service; use the app Bearer Token, not the OAuth Client Secret.');
   if(status===403)throw new AppError(503,'X denied access to the app credit balance. Check the X app’s API access and billing permissions.');
   if(status===402)throw new AppError(503,'X reported insufficient API credit. Replenish the X developer account.');
   if(status===429)throw new AppError(503,'X rate-limited the credit check. Wait a few minutes before connecting again.');
   throw new AppError(503,'Could not verify the X API credit balance. Check X_API_BEARER_TOKEN and X API availability, then retry.');
  }
  if(stage==='storage')throw new AppError(503,'SHEN could not save the X connection attempt. Check the web service’s database migrations and connection.');
  if(stage==='encryption')throw new AppError(503,'SHEN could not encrypt the X connection. Check SERVICE_CREDENTIALS_KEY in the web service.');
  throw new AppError(503,'X connection settings are invalid. Check APP_ORIGIN and the X OAuth credentials in the web service.');
 }
}
export async function finishXConnection(state:string,cookie:string|undefined,owner:string,code:string|null,denied=false){
 if(!/^[a-f0-9]{64}$/.test(state)||cookie!==state)throw new XConnectionError('browser_mismatch');
 const id=await digest(state),attempt=await db().prepare("SELECT * FROM x_oauth_attempts WHERE id=? AND owner=? AND status='pending' AND expires_at>?").bind(id,owner,Date.now()).first<{coin_id:string;encrypted_verifier:string}>();
 if(!attempt)throw new XConnectionError('expired');
 const claimed=await db().prepare("UPDATE x_oauth_attempts SET status='exchanging',encrypted_verifier='' WHERE id=? AND owner=? AND status='pending' AND expires_at>?").bind(id,owner,Date.now()).run();
 if(!claimed.meta.changes)throw new XConnectionError('expired');
 let stage='credentials';
 try{
  if(denied||!code||code.length>2048)throw new XConnectionError('denied');
  const {verifier}=await openServiceSecret(env.SERVICE_CREDENTIALS_KEY,'x-oauth:'+id+':'+owner,attempt.encrypted_verifier) as {verifier:string};
  stage='token';
  const tokens=await exchangeXToken(env.X_CLIENT_ID!,env.X_CLIENT_SECRET!,{grant_type:'authorization_code',code,redirect_uri:xCallbackUrl(),code_verifier:verifier});
  stage='profile';
  const user=await xProvider(env.X_API_BEARER_TOKEN!).me(tokens.accessToken);
  stage='storage';
  const existing=await xAccount(attempt.coin_id);
  if(existing&&existing.user_id!==user.id)throw new XConnectionError('account_mismatch');
  const other=await db().prepare('SELECT coin_id FROM x_accounts WHERE user_id=? AND coin_id!=?').bind(user.id,attempt.coin_id).first();
  if(other)throw new XConnectionError('account_in_use');
  const version=crypto.randomUUID(),encrypted=await sealServiceSecret(env.SERVICE_CREDENTIALS_KEY,attempt.coin_id+':'+user.id+':'+version,tokens);
  const saved=await db().prepare("INSERT INTO x_accounts(coin_id,user_id,username,encrypted_session,version,updated_at,auth_type,reconnect_required,refresh_status) VALUES(?,?,?,?,?,?,'oauth2',0,'idle') ON CONFLICT(coin_id) DO UPDATE SET username=excluded.username,encrypted_session=excluded.encrypted_session,version=excluded.version,updated_at=excluded.updated_at,auth_type='oauth2',reconnect_required=0,refresh_status='idle' WHERE x_accounts.user_id=excluded.user_id").bind(attempt.coin_id,user.id,user.username,encrypted,version,Date.now()).run();
  if(!saved.meta.changes)throw new XConnectionError('account_mismatch');
  await db().prepare("UPDATE x_oauth_attempts SET status='complete' WHERE id=?").bind(id).run();
  return attempt.coin_id;
 }catch(error){
  await db().prepare("UPDATE x_oauth_attempts SET status='failed' WHERE id=?").bind(id).run();
  if(error instanceof XConnectionError)throw error;
  if(stage==='profile')throw new XConnectionError(error instanceof XHttpFailure?error.status===401?'profile_auth':error.status===402?'credits':error.status===403?'profile_access':error.status===429?'rate_limited':'x_unavailable':'x_unavailable');
  throw new XConnectionError('server_error');
 }
}
// The return target comes from the owned, browser-bound attempt, never a query
// parameter supplied by X or an arbitrary redirect URL.
export async function xConnectionCoin(state:string,cookie:string|undefined,owner:string){
 if(!/^[a-f0-9]{64}$/.test(state)||cookie!==state)return null;
 const attempt=await db().prepare('SELECT a.coin_id FROM x_oauth_attempts a JOIN coins c ON c.id=a.coin_id WHERE a.id=? AND a.owner=? AND c.owner=?').bind(await digest(state),owner,owner).first<{coin_id:string}>();
 return attempt?.coin_id??null;
}

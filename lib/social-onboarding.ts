import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { sealServiceSecret } from '../shared/service-secrets.mjs';
import { AppError, db } from './server';
import { xProvider } from './content-providers';
import { matchingTweet } from './content-policy';
import { xAccount, xConfigured, xCosts } from './social-config';

export const xLoginInput=z.object({action:z.literal('connect'),username:z.string().trim().regex(/^[A-Za-z0-9_]{1,15}$/),email:z.string().email().max(254),password:z.string().min(1).max(512),totpSecret:z.string().trim().regex(/^[A-Z2-7a-z]{10,128}$/).optional(),consent:z.literal(true)}).strict();
type Attempt={id:string;coin_id:string;owner:string;user_id:string|null;username:string;encrypted_session:string|null;proof:string;tweet_id:string|null;status:string;checks:number;created_at:number};
async function expireConnecting(coinId:string){await db().prepare("UPDATE x_logins SET status='failed',encrypted_session=NULL WHERE coin_id=? AND status='connecting' AND created_at<?").bind(coinId,Date.now()-300000).run();}
export async function socialStatus(coinId:string){await expireConnecting(coinId);const [account,pending]=await Promise.all([xAccount(coinId),db().prepare("SELECT id,status FROM x_logins WHERE coin_id=? AND status NOT IN ('connected','failed') ORDER BY created_at DESC LIMIT 1").bind(coinId).first<{id:string;status:string}>()]);return {configured:xConfigured(),connected:!!account,username:account?.username??null,pending:pending?{id:pending.id,status:pending.status}:null};}
export async function connectX(coinId:string,owner:string,input:z.infer<typeof xLoginInput>){
 if(!xConfigured())throw new AppError(503,'X account setup is not available yet. Your plan is saved.');
 const account=await xAccount(coinId);
 await expireConnecting(coinId);
 const cap=Number(env.X_LOGIN_DAILY_LIMIT_MICROUSD??1000000),reserve=10000+xCosts().post+xCosts().read*3;
 if(!Number.isSafeInteger(cap)||cap<=0)throw new AppError(503,'X onboarding allowance is unavailable.');
 const proxy=new URL(env.TWITTERAPI_IO_PROXY!);if(!['http:','https:'].includes(proxy.protocol)||!proxy.hostname)throw new AppError(503,'X connectivity is unavailable.');
 const provider=xProvider(env.TWITTERAPI_IO_KEY!);if(await provider.balance()<reserve)throw new AppError(503,'X service credit needs replenishing.');
 const id=crypto.randomUUID(),now=Date.now(),proof='SHEN account verification: '+id;
 const saved=await db().prepare(`INSERT INTO x_logins(id,coin_id,owner,username,proof,status,cost_microusd,created_at) SELECT ?,?,?,?,?,'connecting',?,?
  WHERE NOT EXISTS(SELECT 1 FROM x_logins WHERE coin_id=? AND status NOT IN ('connected','failed'))
  AND (SELECT COUNT(*) FROM x_logins WHERE owner=? AND created_at>?)<3
  AND COALESCE((SELECT SUM(cost_microusd) FROM x_logins WHERE created_at>?),0)+?<=?`)
  .bind(id,coinId,owner,input.username,proof,reserve,now,coinId,owner,now-3600000,now-86400000,reserve,cap).run();
 if(!saved.meta.changes)throw new AppError(429,'An account check is pending or the connection allowance has been reached.');
 let posting=false;
 try{
  const user=await provider.user(input.username);
  if(account&&account.user_id!==user.id)throw new AppError(403,'The X account identity must remain the same.');
  const used=await db().prepare('SELECT coin_id FROM x_accounts WHERE user_id=? AND coin_id!=?').bind(user.id,coinId).first();if(used)throw new AppError(409,'This X account is already connected to another coin.');
  const cookie=await provider.login({user_name:user.username,email:input.email,password:input.password,proxy:proxy.toString(),...(input.totpSecret?{totp_secret:input.totpSecret}:{})});
  const encrypted=await sealServiceSecret(env.SERVICE_CREDENTIALS_KEY,coinId+':'+user.id+':'+id,{loginCookies:cookie,proxy:proxy.toString()});
  const savedSession=await db().prepare("UPDATE x_logins SET user_id=?,username=?,encrypted_session=?,status='verifying' WHERE id=? AND status='connecting'").bind(user.id,user.username,encrypted,id).run();
  if(!savedSession.meta.changes)throw new AppError(409,'The connection attempt expired before verification.');
  // A clearly disclosed verification post proves which account this session
  // actually controls. Public profile lookup alone is not treated as proof.
  posting=true;const tweetId=await provider.post({loginCookies:cookie,proxy:proxy.toString()},proof);
  await db().prepare("UPDATE x_logins SET tweet_id=? WHERE id=? AND status='verifying'").bind(tweetId,id).run();
  return await verifyXConnection(coinId,owner,id);
 }catch(e){if(!posting){await db().prepare("UPDATE x_logins SET status='failed',encrypted_session=NULL WHERE id=?").bind(id).run();if(e instanceof AppError)throw e;throw new AppError(502,'X sign-in did not complete. Check the account details and 2FA setup.');}
  return {...await socialStatus(coinId),message:'The verification result is pending. Check the connection; do not reconnect or repeat the post.'};}
}
export async function verifyXConnection(coinId:string,owner:string,id:string){
 const attempt=await db().prepare('SELECT * FROM x_logins WHERE id=? AND coin_id=? AND owner=?').bind(id,coinId,owner).first<Attempt>();
 if(!attempt)throw new AppError(404,'Connection attempt not found.');if(attempt.status==='connected')return socialStatus(coinId);
 if(attempt.status!=='verifying'||!attempt.user_id||!attempt.encrypted_session)throw new AppError(409,'Account setup needs review before another connection attempt.');
 const gate=await db().prepare("INSERT INTO provider_limits(id,next_at) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET next_at=excluded.next_at WHERE provider_limits.next_at<=? RETURNING id").bind('x-proof:'+id,Date.now()+60000,Date.now()).first();
 if(!gate)throw new AppError(429,'Wait one minute before checking the verification post again.');
 const changed=await db().prepare("UPDATE x_logins SET checks=checks+1 WHERE id=? AND checks<3 AND status='verifying'").bind(id).run();if(!changed.meta.changes)throw new AppError(409,'The account proof needs review. No further verification posts will be sent.');
 const tweets=await xProvider(env.TWITTERAPI_IO_KEY!).tweets(attempt.user_id,attempt.tweet_id??undefined);
 const match=matchingTweet(tweets,{userId:attempt.user_id,text:attempt.proof,startedAt:attempt.created_at});
 if(!match)return {...await socialStatus(coinId),message:'Verification has not appeared on the expected account yet. No new post was sent.'};
 const existing=await xAccount(coinId);if(existing&&existing.user_id!==attempt.user_id)throw new AppError(403,'Account identity cannot change.');
 await db().batch([
  db().prepare(`INSERT INTO x_accounts(coin_id,user_id,username,encrypted_session,version,updated_at) VALUES(?,?,?,?,?,?)
   ON CONFLICT(coin_id) DO UPDATE SET username=excluded.username,encrypted_session=excluded.encrypted_session,version=excluded.version,updated_at=excluded.updated_at WHERE x_accounts.user_id=excluded.user_id`).bind(coinId,attempt.user_id,attempt.username,attempt.encrypted_session,attempt.id,Date.now()),
  db().prepare("UPDATE x_logins SET status='connected',tweet_id=?,encrypted_session=NULL WHERE id=?").bind(match,id),
 ]);
 return socialStatus(coinId);
}

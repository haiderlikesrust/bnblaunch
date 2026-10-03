import { env } from 'cloudflare:workers';
import { validSecretKey, openServiceSecret } from '../shared/service-secrets.mjs';
import { db } from './server';
export function xConfigured(){return !!env.TWITTERAPI_IO_KEY&&!!env.TWITTERAPI_IO_PROXY&&validSecretKey(env.SERVICE_CREDENTIALS_KEY)}
export function xCosts(){const post=Number(env.X_POST_COST_MICROUSD??3000),upload=Number(env.X_UPLOAD_COST_MICROUSD??3000),read=Number(env.X_READ_COST_MICROUSD??5000);if([post,upload,read].some(v=>!Number.isSafeInteger(v)||v<1||v>1000000))throw Error('Invalid X billing rates');return {post,upload,read};}
export type XAccount={coin_id:string;user_id:string;username:string;encrypted_session:string;version:string};
export async function xAccount(coinId:string){return db().prepare('SELECT coin_id,user_id,username,encrypted_session,version FROM x_accounts WHERE coin_id=?').bind(coinId).first<XAccount>()}
export async function xSession(account:XAccount){return await openServiceSecret(env.SERVICE_CREDENTIALS_KEY,account.coin_id+':'+account.user_id+':'+account.version,account.encrypted_session) as {loginCookies:string;proxy:string};}

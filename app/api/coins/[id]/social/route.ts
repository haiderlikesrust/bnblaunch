import { z } from 'zod';
import { identity, ownedCoin, body, response, failure, AppError } from '@/lib/server';
import { beginXConnection, socialStatus, X_OAUTH_COOKIE } from '@/lib/social-onboarding';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){try{const owner=await identity(),{coin}=await ownedCoin((await params).id,owner);return response(await socialStatus(coin.id));}catch(error){return failure(error)}}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{
 const owner=await identity(request),{coin,row}=await ownedCoin((await params).id,owner);
 if(!coin.social)throw new AppError(403,'X was not selected for this agent.');
 // Launching costs gas, so unlaunched coins cannot be used to spend platform X credit.
 if(!row.token_address)throw new AppError(409,'Connect X after the token launches.');
 z.object({action:z.literal('connect'),consent:z.literal(true)}).strict().parse(await body(request));
 const connection=await beginXConnection(coin.id,owner),result=response({url:connection.url});
 result.headers.set('Set-Cookie',X_OAUTH_COOKIE+'='+connection.state+'; Path=/api/social/x/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600');
 return result;
}catch(error){return failure(error)}}

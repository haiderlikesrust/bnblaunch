import { z } from 'zod';
import { identity, ownedCoin, body, response, failure, AppError } from '@/lib/server';
import { beginXConnection, socialStatus, X_OAUTH_COOKIE } from '@/lib/social-onboarding';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){try{const owner=await identity(),{coin}=await ownedCoin((await params).id,owner);return response(await socialStatus(coin.id));}catch(error){return failure(error)}}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{
 const owner=await identity(request),{coin}=await ownedCoin((await params).id,owner);
 if(!coin.social)throw new AppError(403,'X was not selected for this agent.');
 // Ownership, consent and the existing per-wallet/platform OAuth allowances
 // apply before launch too. Publishing remains gated on a confirmed launch.
 z.object({action:z.literal('connect'),consent:z.literal(true)}).strict().parse(await body(request));
 const connection=await beginXConnection(coin.id,owner),result=response({url:connection.url});
 result.headers.set('Set-Cookie',X_OAUTH_COOKIE+'='+connection.state+'; Path=/api/social/x/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600');
 return result;
}catch(error){return failure(error)}}

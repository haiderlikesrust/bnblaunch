import { z } from 'zod';
import { body, failure, identity, ownedCoin, response, AppError } from '@/lib/server';
import { connectX, socialStatus, verifyXConnection, xLoginInput } from '@/lib/social-onboarding';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){try{const owner=await identity(),{coin}=await ownedCoin((await params).id,owner);return response(await socialStatus(coin.id))}catch(e){return failure(e)}}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{const owner=await identity(request),{coin}=await ownedCoin((await params).id,owner);if(!coin.social)throw new AppError(403,'X was not selected for this agent.');const raw=await body(request);if(raw?.action==='check'){const v=z.object({action:z.literal('check'),id:z.string().uuid()}).strict().parse(raw);return response(await verifyXConnection(coin.id,owner,v.id))}return response(await connectX(coin.id,owner,xLoginInput.parse(raw)))}catch(e){return failure(e)}}

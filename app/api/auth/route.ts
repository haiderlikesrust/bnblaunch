import { z } from "zod";
import { type Hex } from "viem";
import { env } from "cloudflare:workers";
import { cookies } from "next/headers";
import { challenge, verifyLogin, getUser, validOrigin, requestOrigin, digest, SESSION_COOKIE } from "@/lib/auth";
import { AppError, body, db, failure, response } from "@/lib/server";
const input=z.discriminatedUnion("action",[
  z.object({action:z.literal("challenge"),wallet:z.string().regex(/^0x[0-9a-fA-F]{40}$/)}).strict(),
  z.object({action:z.literal("verify"),id:z.string().uuid(),signature:z.string().regex(/^0x[0-9a-fA-F]{130}$/)}).strict(),
  z.object({action:z.literal("logout")}).strict(),
]);
export async function GET(){try{return response({user:await getUser()})}catch(e){return failure(e)}}
export async function POST(request:Request){try{
  if(!validOrigin(request))throw new AppError(403,"Cross-origin request rejected.");
  const v=input.parse(await body(request));
  if(v.action==="challenge")return response(await challenge(v.wallet,requestOrigin(request)));
  const jar=await cookies();
  if(v.action==="logout"){const token=jar.get(SESSION_COOKIE)?.value;if(token)await db().prepare("DELETE FROM wallet_sessions WHERE id=?").bind(await digest(token)).run();jar.delete(SESSION_COOKIE);return response({ok:true});}
  let result;try{result=await verifyLogin(v.id,v.signature as Hex)}catch{throw new AppError(401,"Wallet signature is invalid, expired or already used.")}
  jar.set(SESSION_COOKIE,result.token,{httpOnly:true,secure:env.SHEN_RUNTIME==='node'||requestOrigin(request).startsWith('https:'),sameSite:'lax',path:'/',maxAge:86400});
  return response({user:{userId:result.wallet,displayName:result.wallet}});
}catch(e){return failure(e)}}

import { z } from "zod";
import { getUser } from "@/lib/auth";
import { AppError, body, db, failure, identity, ownedCoin, response, type CoinRow } from "@/lib/server";
import { imageInput, validateImage } from "@/lib/token-image";
import { influencerStatus } from "@/lib/influencer-runtime";
import type { Coin } from "@/lib/model";

export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){try{
 const user=await getUser(),{id}=await params;
 const row=await db().prepare("SELECT * FROM coins WHERE id=? AND (token_address IS NOT NULL OR owner=?)").bind(id,user?.userId??"").first<CoinRow>();
 if(!row)throw new AppError(404,"Coin not found.");
 return response(await influencerStatus(JSON.parse(row.config) as Coin,user?.userId===row.owner));
}catch(e){return failure(e)}}
// The optional reference photo or drawing is private and fixed at launch.
const input=z.discriminatedUnion("action",[
 z.object({action:z.literal("reference"),image:imageInput,consent:z.literal(true)}).strict(),
 z.object({action:z.literal("clear-reference")}).strict(),
]);
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{
 const owner=await identity(request),{coin,row}=await ownedCoin((await params).id,owner);
 if(row.token_address||coin.tokenAddress)throw new AppError(403,"The influencer's character is fixed after launch.");
 if(!coin.influencer)throw new AppError(400,"The AI influencer was not enabled for this coin.");
 const v=input.parse(await body(request,3000000));
 const statements=[db().prepare("DELETE FROM influencer_assets WHERE coin_id=? AND kind='reference'").bind(coin.id)];
 if(v.action==="reference"){
  try{validateImage(v.image)}catch(e){throw new AppError(400,(e as Error).message)}
  statements.push(db().prepare("INSERT INTO influencer_assets(id,coin_id,kind,mime,base64,created_at) SELECT ?,?,'reference',?,?,? WHERE EXISTS(SELECT 1 FROM influencers WHERE coin_id=? AND status='pending_launch')").bind(crypto.randomUUID(),coin.id,v.image.mime,v.image.base64,Date.now(),coin.id));
 }
 await db().batch(statements);
 return response({ok:true});
}catch(e){return failure(e)}}

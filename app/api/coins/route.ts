import { blankCoin, type Coin } from "@/lib/model";
import { creatorInput } from "@/lib/policy";
import { PLATFORM_POLICY } from "@/lib/platform-policy";
import { imageInput, validateImage } from "@/lib/token-image";
import { AppError, body, db, eventStatement, failure, identity, response } from "@/lib/server";
export async function GET(){try{const owner=await identity();const [c,e]=await Promise.all([db().prepare("SELECT config FROM coins WHERE owner = ? ORDER BY created_at DESC LIMIT 100").bind(owner).all<{config:string}>(),db().prepare("SELECT id,name,message,created_at as createdAt FROM events WHERE owner = ? ORDER BY created_at DESC LIMIT 100").bind(owner).all()]);return response({coins:c.results.map(r=>JSON.parse(r.config)),events:e.results})}catch(e){return failure(e)}}
export async function POST(request:Request){try{
 const owner=await identity(request);
 const {image,...input}=creatorInput.extend({image:imageInput.optional()}).parse(await body(request,3000000));
 if(image){try{validateImage(image)}catch(e){throw new AppError(400,(e as Error).message)}}
 const id=crypto.randomUUID();
 const coin:Coin={...blankCoin,...input,...PLATFORM_POLICY,id,state:"draft",balance:0,...(image?{imageUrl:`/api/coins/${id}/image`}:{})};
 const now=new Date().toISOString();
 await db().batch([
  db().prepare("INSERT INTO coins (id,owner,config,created_at,updated_at) VALUES (?,?,?,?,?)").bind(id,owner,JSON.stringify(coin),now,now),
  ...(image?[db().prepare("INSERT INTO coin_images (coin_id,mime,base64) VALUES (?,?,?)").bind(id,image.mime,image.base64)]:[]),
  eventStatement(coin,owner,"Launch plan saved. 100% of distributable fees route to the agent; service costs are paid first. No token launched.")
 ]);
 return response({coin},201)
}catch(e){return failure(e)}}

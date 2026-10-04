import { blankCoin, type Coin } from "@/lib/model";
import { creatorFields, influencerNeedsX } from "@/lib/policy";
import { PLATFORM_POLICY } from "@/lib/platform-policy";
import { imageInput, validateImage } from "@/lib/token-image";
import { AppError, body, db, eventStatement, failure, identity, response } from "@/lib/server";
// Saved artwork and OAuth drafts remain recoverable before a launch is prepared.
const visible="(c.token_address IS NOT NULL OR EXISTS(SELECT 1 FROM prepared_launches p WHERE p.coin_id=c.id) OR EXISTS(SELECT 1 FROM x_oauth_attempts x WHERE x.coin_id=c.id) OR EXISTS(SELECT 1 FROM coin_images i WHERE i.coin_id=c.id))";
export async function GET(){try{const owner=await identity();const [c,e]=await Promise.all([db().prepare(`SELECT c.config FROM coins c WHERE c.owner = ? AND ${visible} ORDER BY c.created_at DESC LIMIT 100`).bind(owner).all<{config:string}>(),db().prepare(`SELECT e.id,e.name,e.message,e.created_at as createdAt FROM events e JOIN coins c ON c.id=e.coin_id WHERE e.owner = ? AND ${visible} ORDER BY e.created_at DESC LIMIT 100`).bind(owner).all()]);return response({coins:c.results.map(r=>JSON.parse(r.config)),events:e.results})}catch(e){return failure(e)}}
export async function POST(request:Request){try{
 const owner=await identity(request);
 const {image,...input}=creatorFields.extend({image:imageInput.optional()}).refine(...influencerNeedsX).parse(await body(request,3000000));
 if(image){try{validateImage(image)}catch(e){throw new AppError(400,(e as Error).message)}}
 const id=crypto.randomUUID();
 const coin:Coin={...blankCoin,...input,...PLATFORM_POLICY,id,state:"draft",balance:0,...(image?{imageUrl:`/api/coins/${id}/image`}:{})};
 const now=new Date().toISOString(),since=new Date(Date.now()-86400000).toISOString();
 // Each coin provisions an agent wallet at launch; bound unlaunched attempts per wallet.
 const results=await db().batch([
  db().prepare("INSERT INTO coins (id,owner,config,created_at,updated_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM coins WHERE owner=? AND token_address IS NULL AND created_at>?)<10").bind(id,owner,JSON.stringify(coin),now,now,owner,since),
  ...(image?[db().prepare("INSERT INTO coin_images (coin_id,mime,base64) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM coins WHERE id=?)").bind(id,image.mime,image.base64,id)]:[]),
  ...(input.influencer?[db().prepare("INSERT INTO influencers(coin_id,config,status,created_at,updated_at) SELECT ?,?,'pending_launch',?,? WHERE EXISTS(SELECT 1 FROM coins WHERE id=?)").bind(id,JSON.stringify(input.influencer),Date.now(),Date.now(),id)]:[]),
 ]);
 if(!results[0].meta.changes)throw new AppError(429,"Too many unfinished launches from this wallet today. Finish one from My agents or try again tomorrow.");
 await eventStatement(coin,owner,"Launch started. 85% of distributable fees fund the agent, with service costs paid first; 15% fund system SHEN buybacks and burns.").run();
 return response({coin},201)
}catch(e){return failure(e)}}

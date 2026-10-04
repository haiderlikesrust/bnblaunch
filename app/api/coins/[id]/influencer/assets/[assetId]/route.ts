import { getUser } from "@/lib/auth";
import { db, failure, response, storedImage } from "@/lib/server";

// Character and post images are public once launched; the reference stays owner-only.
export async function GET(_request:Request,{params}:{params:Promise<{id:string;assetId:string}>}){try{
 const {id,assetId}=await params,user=await getUser();
 const row=await db().prepare("SELECT a.kind,a.mime,a.base64,c.token_address,c.owner FROM influencer_assets a JOIN coins c ON c.id=a.coin_id WHERE a.id=? AND a.coin_id=?").bind(assetId,id).first<{kind:string;mime:string;base64:string;token_address:string|null;owner:string}>();
 const owner=!!user&&user.userId===row?.owner;
 if(!row||(!owner&&(row.kind==='reference'||!row.token_address)))return response({error:'Image not found'},404);
 return storedImage(row.mime,row.base64,row.kind!=='reference'&&!!row.token_address);
}catch(e){return failure(e)}}

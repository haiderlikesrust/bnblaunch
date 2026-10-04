import { db,response,failure,storedImage } from '@/lib/server';
import { getUser } from '@/lib/auth';
export async function GET(_request:Request,{params}:{params:Promise<{id:string;frameId:string}>}){try{
  const {id,frameId}=await params,user=await getUser();
  const row=await db().prepare("SELECT f.base64,c.token_address FROM browser_frames f JOIN browser_sessions s ON s.id=f.session_id JOIN coins c ON c.id=f.coin_id WHERE f.id=? AND f.coin_id=? AND s.status='complete' AND (c.token_address IS NOT NULL OR c.owner=?)").bind(frameId,id,user?.userId??'').first<{base64:string;token_address:string|null}>();
  if(!row)return response({error:'Capture not found'},404);
  return storedImage('image/jpeg',row.base64,!!row.token_address);
}catch(e){return failure(e)}}

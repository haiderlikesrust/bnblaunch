import { db,failure,response,AppError } from '@/lib/server';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){try{
 const id=(await params).id;
 if(!await db().prepare('SELECT id FROM coins WHERE id=? AND token_address IS NOT NULL').bind(id).first())throw new AppError(404,'Launched coin not found.');
 const rows=await db().prepare("SELECT id,kind,amount_wei,status,tx_hash,created_at,reason,details FROM agent_operations WHERE coin_id=? ORDER BY created_at DESC LIMIT 50").bind(id).all<{id:string;kind:string;amount_wei:string;status:string;tx_hash:string|null;created_at:number;reason:string;details:string|null}>();
 return response({operations:rows.results.map(r=>({id:r.id,kind:r.kind,amountWei:r.amount_wei,status:r.status,hash:r.tx_hash,createdAt:r.created_at,reason:r.reason,details:r.details?JSON.parse(r.details):null}))});
}catch(error){return failure(error)}}

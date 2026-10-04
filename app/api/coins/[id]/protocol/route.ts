import { db, response, failure, AppError } from '@/lib/server';
import { signerRequest } from '@/lib/signer';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const {id}=await params;
  if(!await db().prepare('SELECT id FROM coins WHERE id=? AND token_address IS NOT NULL').bind(id).first())throw new AppError(404,'Launched coin not found.');
  return response(await signerRequest(`/v1/wallets/${id}/protocol`));
 }catch(error){return failure(error);}
}

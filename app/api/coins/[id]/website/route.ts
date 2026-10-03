import { publishedWebsite } from '@/lib/websites';
import { AppError, db, failure, response } from '@/lib/server';
import { getUser } from '@/lib/auth';
import {publicDomain} from '@/lib/custom-domains';

export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const id=(await params).id,user=await getUser();
  const coin=await db().prepare('SELECT id FROM coins WHERE id=? AND (token_address IS NOT NULL OR owner=?)').bind(id,user?.userId??'').first();
  if(!coin)throw new AppError(404,'Coin not found.');
  const [published,domain]=await Promise.all([publishedWebsite(id),publicDomain(id)]);
  return response({site:published?.site??null,domain});
 }catch(error){return failure(error)}
}

import { agentModel } from "@/lib/agent-models";
import { db, response, failure, AppError } from '@/lib/server';
import { codeReady } from '@/lib/code-runtime';
import { sharedPersona } from '@/lib/agent-persona';
import type { Coin } from '@/lib/model';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const {id}=await params,row=await db().prepare('SELECT config FROM coins WHERE id=? AND token_address IS NOT NULL').bind(id).first<{config:string}>();
  if(!row)throw new AppError(404,'Published agent not found.');
  const jobs=await db().prepare('SELECT id,status,payload,result,cost_microusd,created_at FROM code_jobs WHERE coin_id=? ORDER BY created_at DESC LIMIT 6').bind(id).all<{id:string;status:string;payload:string;result:string|null;cost_microusd:number;created_at:number}>();
  return response({model:agentModel((JSON.parse(row.config) as Coin).modelId).name,available:await codeReady(),persona:await sharedPersona(JSON.parse(row.config) as Coin),jobs:jobs.results.map(r=>({id:r.id,status:r.status,proposal:JSON.parse(r.payload),result:r.result?JSON.parse(r.result):null,costMicrousd:r.cost_microusd,createdAt:r.created_at}))});
 }catch(error){return failure(error)}
}

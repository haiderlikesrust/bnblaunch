import { z } from "zod";
import { body, db, failure, response, AppError } from "@/lib/server";
import { requireWorker, runAgentTick, refreshRuntimeHealth } from "@/lib/runtime";
import { signerRequest } from "@/lib/signer";
import { settleComputePayment } from "@/lib/funding";
import { chainClient } from "@/lib/providers";
import type { Hex } from "viem";
import { domainFundingRequests, runDomainTick } from '@/lib/domain-runtime';
import { runContentTick } from '@/lib/content-runtime';

export async function GET(request:Request){try{await requireWorker(request);const ops=await db().prepare("SELECT id,coin_id AS coinId,kind,amount_wei AS amountWei,expires_at AS expiresAt,status,tx_hash AS hash FROM agent_operations WHERE status IN ('queued','signed','broadcast') ORDER BY created_at LIMIT 20").all();return response({operations:ops.results,domainFunding:await domainFundingRequests()});}catch(e){return failure(e)}}
const payload=z.discriminatedUnion("action",[z.object({action:z.literal("domains")}).strict(),z.object({action:z.literal("tick")}).strict(),z.object({action:z.literal("reconcile"),id:z.string().uuid()}).strict()]);
export async function POST(request:Request){try{
  await requireWorker(request);const input=payload.parse(await body(request));
  if(input.action==="domains")return response(await runDomainTick());
  if(input.action==="tick"){const capabilities=await refreshRuntimeHealth();if(!capabilities.includes('autonomous-planning'))return response({processed:false,reason:'runtime_configuration_required'});const content=await runContentTick();return response(content.processed?content:await runAgentTick(capabilities));}
  const op=await db().prepare("SELECT * FROM agent_operations WHERE id=?").bind(input.id).first<{id:string;coin_id:string;kind:string;amount_wei:string;status:string;created_at:number;expires_at:number}>();
  if(!op)throw new AppError(404,"Operation not found.");
  if(["confirmed","reverted","expired"].includes(op.status))return response({status:op.status});
  const record=await signerRequest<{checkedAt:number;intent:null|{id:string;coinId:string;kind:string;amountWei:string;status:string;hash:string|null}}>(`/v1/intents/${op.id}/record`);
  const intent=record.intent;
  if(!intent||intent.status==="created"||intent.status==="expired"){
    if(intent?.status==="expired"||(!intent&&record.checkedAt>=op.expires_at)){await db().prepare("UPDATE agent_operations SET status='expired' WHERE id=? AND status='queued'").bind(op.id).run();return response({status:"expired"});}
    return response({status:"queued"});
  }
  if(intent.coinId!==op.coin_id||intent.kind!==op.kind||intent.amountWei!==op.amount_wei||!intent.hash)throw new AppError(503,"Signing journal does not match the saved operation.");
  const hash=intent.hash as Hex;
  if(intent.status==="confirmed"&&op.kind==="compute"){await settleComputePayment(op,hash);return response({status:"confirmed"});}
  if(intent.status==="confirmed"||intent.status==="reverted"){
    const client=chainClient(),receipt=await client.getTransactionReceipt({hash}),head=await client.getBlockNumber(),block=await client.getBlock({blockNumber:receipt.blockNumber});
    if(head-receipt.blockNumber<3n||receipt.blockHash!==block.hash||((receipt.status==="success")!==(intent.status==="confirmed")))throw new AppError(409,"Transaction receipt is awaiting reconciliation.");
  }
  await db().batch([
    db().prepare("UPDATE agent_operations SET status=?,tx_hash=? WHERE id=? AND status IN ('queued','signed','broadcast')").bind(intent.status,hash,op.id),
    db().prepare("INSERT INTO events(id,coin_id,owner,name,message,created_at) SELECT ?,id,owner,json_extract(config,'$.name'),?,? FROM coins WHERE id=? AND ? IN ('confirmed','reverted') ON CONFLICT(id) DO NOTHING").bind("operation:"+op.id,`${op.kind==='burn'?'Burn-sink transfer':op.kind} ${intent.status}: ${hash}`,new Date().toISOString(),op.coin_id,intent.status),
  ]);
  return response({status:intent.status});
}catch(e){return failure(e)}}

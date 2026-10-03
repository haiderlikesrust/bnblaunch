import { env } from "cloudflare:workers";
import { AppError, db } from "./server";

export async function reserveChat(coinId:string,viewer:string,ceiling:number,closesAt:number){
 const cap=Number(env.CHAT_DAILY_LIMIT_MICROUSD);
 if(!Number.isSafeInteger(cap)||cap<=0)throw new AppError(412,"Live chat awaits a platform chat allowance. No model call was made.");
 const id=crypto.randomUUID(),now=Date.now(),day=now-86400000,minute=now-60000;
 const result=await db().batch([
  db().prepare(`INSERT INTO chat_runs (id,coin_id,viewer,status,reserved_microusd,created_at)
   SELECT ?,id,?,'reserved',?,? FROM coins WHERE id=? AND ai_credit_microusd>=?
   AND unixepoch()*1000<? AND json_extract(config,'$.state')!='paused'
   AND NOT EXISTS(SELECT 1 FROM agent_chat_control WHERE coin_id=coins.id AND closed_until>unixepoch()*1000)
   AND COALESCE((SELECT SUM(COALESCE(cost_microusd,reserved_microusd)) FROM chat_runs WHERE created_at>?),0)+?<=?
   AND (SELECT COUNT(*) FROM chat_runs WHERE viewer=? AND created_at>?)<4
   AND (SELECT COUNT(*) FROM chat_runs WHERE coin_id=? AND created_at>?)<12
   AND (SELECT COUNT(*) FROM chat_runs WHERE created_at>?)<60`).bind(id,viewer,ceiling,now,coinId,ceiling,closesAt,day,ceiling,cap,viewer,minute,coinId,minute,minute),
  db().prepare("UPDATE coins SET ai_credit_microusd=ai_credit_microusd-? WHERE id=? AND EXISTS (SELECT 1 FROM chat_runs WHERE id=?)").bind(ceiling,coinId,id),
 ]);
 if(!result[0].meta.changes)throw new AppError(429,"Chat is waiting for compute credit or its usage limit to reset. No model call was made.");
 return {id,coinId,ceiling};
}
export async function settleChat(run:{id:string;coinId:string;ceiling:number},cost:number){
 if(!Number.isSafeInteger(cost)||cost<0||cost>run.ceiling)throw new AppError(503,"Chat cost requires reconciliation.");
 await db().batch([
  db().prepare("UPDATE coins SET ai_credit_microusd=ai_credit_microusd+? WHERE id=? AND EXISTS (SELECT 1 FROM chat_runs WHERE id=? AND status='reserved')").bind(run.ceiling-cost,run.coinId,run.id),
  db().prepare("UPDATE chat_runs SET status='settled',cost_microusd=? WHERE id=? AND status='reserved'").bind(cost,run.id),
 ]);
}

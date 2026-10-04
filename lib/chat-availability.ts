import { env } from "cloudflare:workers";
import type { Coin } from "./model";
import { db, type CoinRow } from "./server";
import { chatWindow, chatDailyCap, type ChatWindow } from "./chat-schedule";
import { chatPrice, callCeiling } from "./chat-completion";
import { agentModel, GUARDRAIL_MODEL } from "./agent-models";

export async function availability(coin:Coin,row?:CoinRow):Promise<ChatWindow>{
 const now=Date.now(),cap=chatDailyCap(env.CHAT_DAILY_LIMIT_MICROUSD);
 const closed=(reason:ChatWindow["reason"]):ChatWindow=>({open:false,cadence:"closed",durationMinutes:0,closesAt:null,nextOpensAt:null,reason,checkedAt:now});
 if(!row||!env.OPENROUTER_API_KEY||!cap)return closed("platform_setup");
 const epoch=Math.floor(now/3600000)*3600000;
 const [prices,funding,control]=await Promise.all([
  Promise.all([chatPrice(GUARDRAIL_MODEL),chatPrice(agentModel(coin.modelId).id)]),
  // A seven-day average keeps weekly top-ups from leaving chat closed most days.
  db().prepare("SELECT COUNT(*) AS verified_count,COALESCE(SUM(CASE WHEN settled_at>=? AND settled_at<? THEN amount_microusd ELSE 0 END),0) AS recent FROM compute_funding WHERE coin_id=?").bind(epoch-7*86400000,epoch,coin.id).first<{verified_count:number;recent:number}>(),
  db().prepare("SELECT closed_until FROM agent_chat_control WHERE coin_id=?").bind(coin.id).first<{closed_until:number}>(),
 ]);
 const questionCeiling=callCeiling(prices[0])*2+callCeiling(prices[1]);
 if(cap<questionCeiling)return closed("platform_setup");
 return chatWindow({now,coinId:coin.id,launched:!!coin.tokenAddress,paused:coin.state==="paused",fundedMicrousdDaily:Math.floor(Number(funding?.recent??0)/7),fundingVerified:Number(funding?.verified_count??0)>0,observedAt:coin.treasuryObservedAt??0,creditMicrousd:row.ai_credit_microusd,questionCeilingMicrousd:questionCeiling,closedUntil:control?.closed_until});
}
// Trusted worker control only. No browser route exposes this operation, and
// visitor transcripts never enter the autonomous worker's decision context.
export async function closeAgentChat(coinId:string,until:number){
 const now=Date.now();if(!Number.isSafeInteger(until)||until<=now||until>now+86400000)throw new Error("Invalid chat pause interval");
 await db().prepare("INSERT INTO agent_chat_control (coin_id,closed_until) VALUES (?,?) ON CONFLICT(coin_id) DO UPDATE SET closed_until=excluded.closed_until").bind(coinId,until).run();
}

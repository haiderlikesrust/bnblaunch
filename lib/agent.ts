import { AppError, persist, type CoinRow } from "./server";
import { confirmedBalance } from "./providers";
import { launchReadiness } from "./signer";
import type { Coin } from "./model";

export async function inspectAgent(coin:Coin,row:CoinRow){
  if(!coin.tokenAddress||!coin.treasuryAddress)return {ready:false,reason:"launch_confirmation_required",balance:0};
  const balance=await confirmedBalance(coin.treasuryAddress),runtime=await launchReadiness(coin);
  const reason=!runtime.ready?"agent_services_unavailable":balance.bnb<coin.threshold?"below_activation_threshold":row.ai_credit_microusd<=0?"service_funding_pending":"ready";
  return {ready:reason==="ready",reason,balance:balance.bnb,confirmedBlock:balance.block};
}
export async function generateSite(coin:Coin,_row:CoinRow):Promise<never>{
  if(coin.tokenAddress)throw new AppError(403,"The agent manages its website autonomously. Developer requests cannot trigger its actions.");
  throw new AppError(412,"The agent creates its website after launch and treasury activation.");
}
export async function checkAndRecord(coin:Coin,row:CoinRow){
  const check=await inspectAgent(coin,row);
  // Owner checks observe launched agents; they cannot reset the worker's state.
  if(coin.tokenAddress)return {coin,output:check};
  const next:Coin={...coin,balance:0,state:coin.state==="paused"?"paused":"draft"};
  await persist(next,row.owner,"就绪检查 · Readiness: "+check.reason,row.config);return {coin:next,output:check};
}

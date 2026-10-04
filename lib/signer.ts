import { env } from "cloudflare:workers";
import { isAddress, type Address } from "viem";
import { AppError, db } from "./server";
import type { Coin } from "./model";
import { xAccount, xConnected } from './social-config';

export async function signerRequest<T>(path:string,data?:unknown):Promise<T>{
  if(!env.SIGNER_URL||!env.SIGNER_WEB_TOKEN||env.SIGNER_WEB_TOKEN.length<40)throw new AppError(503,"Agent wallets are not configured yet. Your launch plan is saved.");
  const base=new URL(env.SIGNER_URL);
  const internal=env.SHEN_RUNTIME==='node'&&base.protocol==='http:'&&base.hostname==='signer'&&base.port==='8080';
  if((base.protocol!=="https:"&&!internal)||base.username||base.password||base.search||base.hash)throw new AppError(503,"The signing service requires a secure endpoint.");
  const result=await fetch(new URL(path,base),{method:data===undefined?"GET":"POST",headers:{Authorization:"Bearer "+env.SIGNER_WEB_TOKEN,"Content-Type":"application/json"},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(20000),redirect:"error"});
  if(!result.ok)throw new AppError(503,"The agent wallet service is unavailable. Retry this operation; no replacement wallet will be created.");
  return await result.json() as T;
}
export async function agentWallet(coinId:string){
  const value=await signerRequest<{coinId:string;address:string;chainId:number}>(`/v1/wallets/${coinId}/provision`,{});
  if(value.coinId!==coinId||value.chainId!==56||!isAddress(value.address))throw new AppError(503,"Agent wallet response could not be verified.");
  await db().prepare("INSERT INTO agent_wallets(coin_id,address,created_at) VALUES(?,?,?) ON CONFLICT(coin_id) DO NOTHING").bind(coinId,value.address.toLowerCase(),Date.now()).run();
  const row=await db().prepare("SELECT address FROM agent_wallets WHERE coin_id=?").bind(coinId).first<{address:string}>();
  if(!row||row.address!==value.address.toLowerCase())throw new AppError(503,"Agent wallet binding changed. Launch is blocked.");
  return value.address as Address;
}
export async function launchReadiness(coin:Coin){
  if(coin.social&&!xConnected(await xAccount(coin.id)))return {ready:false,reason:"Connect and verify the coin’s X account below before launching."};
  const required=["funding-reconciliation","cost-reservations","autonomous-planning","transaction-execution",...(coin.website?["website-publishing"]:[]),...(coin.social?["x-publishing"]:[]),...(coin.research?["brave-research"]:[]),...(coin.images?["image-publishing"]:[])];
  if(!env.SIGNER_URL||!env.SIGNER_WEB_TOKEN)return {ready:false,reason:"Agent wallet service needs to be connected."};
  if(!env.OPENROUTER_API_KEY)return {ready:false,reason:"Agent compute needs to be configured."};
  const health=await db().prepare("SELECT checked_at,capabilities FROM runtime_health WHERE id='worker'").first<{checked_at:number;capabilities:string}>();
  if(!health||!Number.isSafeInteger(health.checked_at)||health.checked_at>Date.now()+10000||Date.now()-health.checked_at>120000)return {ready:false,reason:"The agent worker is not ready. Your plan is saved; launch opens when its services are available."};
  const capabilities:unknown=JSON.parse(health.capabilities);
  if(!Array.isArray(capabilities)||required.some(v=>!capabilities.includes(v)))return {ready:false,reason:"Some of this agent’s services are still being connected. Your launch plan is saved."};
  const signer=await signerRequest<{chainId:number;signingReady:boolean}>("/v1/status");
  return signer.chainId===56&&signer.signingReady?{ready:true,reason:"Ready"}:{ready:false,reason:"Agent transaction signing is unavailable."};
}
export async function requireLaunchReady(coin:Coin){const status=await launchReadiness(coin);if(!status.ready)throw new AppError(503,status.reason);}

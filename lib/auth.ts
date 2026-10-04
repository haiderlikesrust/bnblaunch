import { env } from "cloudflare:workers";
import { cookies } from "next/headers";
import { verifyMessage, isAddress, getAddress, type Address, type Hex } from "viem";
import { AppError } from "./app-error";
export const SESSION_COOKIE="shen_session";
const database=()=>{if(!env.DB)throw Error("Authentication storage unavailable");return env.DB};
export async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,"0")).join("");}
export function requestOrigin(request:Request){
  // Normalized, so a configured trailing slash cannot reject every POST.
  const origin=new URL(env.APP_ORIGIN??new URL(request.url).origin).origin;
  if(env.SHEN_RUNTIME==='node'&&(!env.APP_ORIGIN||new URL(origin).protocol!=='https:'))throw Error("APP_ORIGIN must be the public HTTPS origin");
  return origin;
}
export function validOrigin(request:Request){return request.headers.get("origin")===requestOrigin(request);}
export async function getUser(){
  const token=(await cookies()).get(SESSION_COOKIE)?.value;
  if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
  const row=await database().prepare("SELECT wallet FROM wallet_sessions WHERE id=? AND expires_at>?").bind(await digest(token),Date.now()).first<{wallet:string}>();
  return row?{userId:row.wallet,displayName:row.wallet}:null;
}
export async function challenge(wallet:string,origin:string){
  if(!isAddress(wallet))throw new AppError(400,"Invalid wallet address");
  const id=crypto.randomUUID(),now=Date.now(),expiresAt=now+300000,address=wallet.toLowerCase();
  // EIP-4361 uses the checksummed address; strict wallets verify the domain line.
  const message=[`${new URL(origin).host} wants you to sign in with your Ethereum account:`,getAddress(wallet),"","Sign in to SHEN. This does not authorize a transaction.","",`URI: ${origin}`,"Version: 1","Chain ID: 56",`Nonce: ${id.replaceAll('-','')}`,`Issued At: ${new Date(now).toISOString()}`,`Expiration Time: ${new Date(expiresAt).toISOString()}`].join("\n");
  // Expired rows are purged, and a wallet's oldest pending challenge is evicted
  // instead of refusing, so nobody can lock another wallet out of signing in.
  await database().batch([
    database().prepare("DELETE FROM wallet_challenges WHERE expires_at<?").bind(now-60000),
    database().prepare("DELETE FROM wallet_challenges WHERE wallet=? AND consumed=0 AND expires_at<=(SELECT expires_at FROM wallet_challenges WHERE wallet=? AND consumed=0 ORDER BY expires_at DESC LIMIT 1 OFFSET 3)").bind(address,address),
  ]);
  const saved=await database().prepare("INSERT INTO wallet_challenges(id,wallet,message,expires_at,consumed) SELECT ?,?,?,?,0 WHERE (SELECT COUNT(*) FROM wallet_challenges WHERE expires_at>? AND consumed=0)<20000").bind(id,address,message,expiresAt,now).run();
  if(!saved.meta.changes)throw new AppError(429,"Too many active login requests. Try again in a few minutes.");
  return {id,message,expiresAt};
}
export async function verifyLogin(id:string,signature:Hex){
  const row=await database().prepare("SELECT wallet,message FROM wallet_challenges WHERE id=? AND expires_at>? AND consumed=0").bind(id,Date.now()).first<{wallet:string;message:string}>();
  if(!row||!await verifyMessage({address:row.wallet as Address,message:row.message,signature}).catch(()=>false))throw new AppError(401,"Wallet signature is invalid, expired or already used.");
  const token=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,"0")).join("");
  const tokenHash=await digest(token),now=Date.now();
  // The single-use challenge and new session commit in one database transaction.
  await database().batch([
    database().prepare("INSERT INTO wallet_sessions(id,wallet,expires_at) SELECT ?,wallet,? FROM wallet_challenges WHERE id=? AND consumed=0 AND expires_at>?").bind(tokenHash,now+86400000,id,now),
    database().prepare("UPDATE wallet_challenges SET consumed=1 WHERE id=? AND consumed=0 AND EXISTS(SELECT 1 FROM wallet_sessions WHERE id=?)").bind(id,tokenHash),
    database().prepare("DELETE FROM wallet_sessions WHERE expires_at<?").bind(now),
  ]);
  if(!await database().prepare("SELECT id FROM wallet_sessions WHERE id=?").bind(tokenHash).first())throw new AppError(401,"Login request was already used.");
  return {token,wallet:row.wallet};
}

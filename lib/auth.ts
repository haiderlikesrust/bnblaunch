import { env } from "cloudflare:workers";
import { cookies } from "next/headers";
import { verifyMessage, isAddress, type Address, type Hex } from "viem";
export const SESSION_COOKIE="shen_session";
const database=()=>{if(!env.DB)throw Error("Authentication storage unavailable");return env.DB};
export async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,"0")).join("");}
export function requestOrigin(request:Request){
  const origin=env.APP_ORIGIN??new URL(request.url).origin;
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
  if(!isAddress(wallet))throw Error("Invalid wallet address");
  const id=crypto.randomUUID(),now=Date.now(),expiresAt=now+300000;
  const message=[`${new URL(origin).host} wants you to sign in with your Ethereum account:`,wallet,"","Sign in to SHEN. This does not authorize a transaction.","",`URI: ${origin}`,"Version: 1","Chain ID: 56",`Nonce: ${id.replaceAll('-','')}`,`Issued At: ${new Date(now).toISOString()}`,`Expiration Time: ${new Date(expiresAt).toISOString()}`].join("\n");
  const saved=await database().prepare("INSERT INTO wallet_challenges(id,wallet,message,expires_at,consumed) SELECT ?,?,?,?,0 WHERE (SELECT COUNT(*) FROM wallet_challenges WHERE wallet=? AND expires_at>? AND consumed=0)<5 AND (SELECT COUNT(*) FROM wallet_challenges WHERE expires_at>?)<1000").bind(id,wallet.toLowerCase(),message,expiresAt,wallet.toLowerCase(),now,now).run();
  if(!saved.meta.changes)throw Error("Too many active login requests. Try again in a few minutes.");
  return {id,message,expiresAt};
}
export async function verifyLogin(id:string,signature:Hex){
  const row=await database().prepare("SELECT wallet,message FROM wallet_challenges WHERE id=? AND expires_at>? AND consumed=0").bind(id,Date.now()).first<{wallet:string;message:string}>();
  if(!row||!await verifyMessage({address:row.wallet as Address,message:row.message,signature}))throw Error("Wallet signature is invalid, expired or already used.");
  const token=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,"0")).join("");
  const tokenHash=await digest(token),now=Date.now();
  // The single-use challenge and new session commit in one database transaction.
  await database().batch([
    database().prepare("INSERT INTO wallet_sessions(id,wallet,expires_at) SELECT ?,wallet,? FROM wallet_challenges WHERE id=? AND consumed=0 AND expires_at>?").bind(tokenHash,now+86400000,id,now),
    database().prepare("UPDATE wallet_challenges SET consumed=1 WHERE id=? AND consumed=0 AND EXISTS(SELECT 1 FROM wallet_sessions WHERE id=?)").bind(id,tokenHash),
  ]);
  if(!await database().prepare("SELECT id FROM wallet_sessions WHERE id=?").bind(tokenHash).first())throw Error("Login request was already used.");
  return {token,wallet:row.wallet};
}

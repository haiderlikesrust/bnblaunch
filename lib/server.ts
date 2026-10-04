import { env } from "cloudflare:workers";
import { getUser, validOrigin } from "@/lib/auth";
import type { Coin } from "./model";
export class AppError extends Error{status:number;constructor(status:number,message:string){super(message);this.status=status}}
export function db(){if(!env.DB)throw new AppError(503,"Storage unavailable. Your input has not been discarded.");return env.DB;}
export async function identity(request?:Request){if(request&&request.method!=="GET"&&!validOrigin(request))throw new AppError(403,"Cross-origin request rejected.");const user=await getUser();if(!user)throw new AppError(401,"请先连接钱包。Sign in with your wallet to continue.");return user.userId;}
export async function readBody(request:Request,maxBytes=20000){
 if(Number(request.headers.get('content-length')??0)>maxBytes)throw new AppError(413,"Request too large");
 const reader=request.body?.getReader(),parts:Uint8Array[]=[];let size=0;
 if(reader)try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>maxBytes){await reader.cancel();throw new AppError(413,"Request too large");}parts.push(chunk.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}return bytes;
}
export async function body(request:Request,maxBytes=20000){const bytes=await readBody(request,maxBytes);try{return JSON.parse(new TextDecoder().decode(bytes))}catch{throw new AppError(400,"Invalid JSON")}}
export function response(data:unknown,status=200){return Response.json(data,{status,headers:{"Cache-Control":"no-store"}})}
export function failure(error:unknown){if(error instanceof AppError)return response({error:error.message},error.status);if(error&&typeof error==="object"&&"issues" in error)return response({error:"Invalid input",details:(error as {issues:unknown}).issues},400);console.error("Request failed",error instanceof Error?error.message:"unknown");return response({error:"Service unavailable. Please retry later; your input is preserved."},503)}
export type CoinRow={id:string;owner:string;config:string;token_address:string|null;treasury_address:string|null;ai_credit_microusd:number;daily_limit_microusd:number};
export async function ownedCoin(id:string,owner:string){const row=await db().prepare("SELECT * FROM coins WHERE id = ? AND owner = ?").bind(id,owner).first<CoinRow>();if(!row)throw new AppError(404,"This plan is unavailable for the signed-in wallet. Sign in with the wallet that created it and reopen it from My agents.");return {row,coin:JSON.parse(row.config) as Coin};}
export function eventStatement(coin:Coin,owner:string,message:string){return db().prepare("INSERT INTO events (id,coin_id,owner,name,message,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(),coin.id,owner,coin.name,message,new Date().toISOString());}
export async function persist(coin:Coin,owner:string,message:string,expectedConfig:string){const r=await db().prepare("UPDATE coins SET config = ?, updated_at = ? WHERE id = ? AND owner = ? AND config = ?").bind(JSON.stringify(coin),new Date().toISOString(),coin.id,owner,expectedConfig).run();if(!r.meta.changes)throw new AppError(409,"The plan changed during this action. Reload and retry.");await eventStatement(coin,owner,message).run();}
export async function remoteJson<T>(url:string,init:RequestInit={},timeoutMs=45000){const r=await fetch(url,{...init,signal:AbortSignal.timeout(timeoutMs)});if(!r.ok)throw new AppError(502,`Provider request failed (${r.status}). No success has been recorded.`);return await r.json() as T;}

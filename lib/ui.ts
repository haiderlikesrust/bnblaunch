import type { Coin, Language } from "./model";
export type T=(zh:string,en:string)=>string;
export function stateLabel(c:Coin,t:T){return c.state==="active"?t("资金已达标","Funded"):c.state==="paused"?t("已暂停","Paused"):c.state==="draft"?t("草稿","Draft"):t("待筹资","Awaiting funding")}
export type ApiResponse={coins:Coin[];coin:Coin;canManage?:boolean;events:{id:string;name:string;message:string;createdAt:string}[];configured:Record<string,boolean>;error:string;output:unknown};
export async function api(url:string,body?:unknown){const r=await fetch(url,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:undefined);const data=await r.json() as ApiResponse;if(!r.ok)throw new Error(data.error||"Request failed");return data;}

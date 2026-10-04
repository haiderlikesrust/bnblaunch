import { recordModelUsage, type UsageContext } from "./model-usage";
import { env } from "cloudflare:workers";
import { AppError, remoteJson } from "./server";
import { isAgentModel } from "./agent-models";

type CatalogModel={id:string;pricing:Record<string,string>;supported_parameters:string[];reasoning?:{supported_efforts?:string[]|null}};
export type ChatPrice={id:string;prompt:number;completion:number;reasoningEffort?:'low'};
// Output rejection does not erase a validated provider receipt. Callers may
// settle this cost, but must never use the rejected completion for any action.
export class PaidCompletionRejected extends AppError{
 readonly cost:number;
 readonly truncated:boolean;
 constructor(cost:number,truncated=false){super(503,"The answer could not be verified. No action was taken.");this.name="PaidCompletionRejected";this.cost=cost;this.truncated=truncated;}
}
let cache:{expires:number;models:CatalogModel[]}|undefined;
let catalogRequest:Promise<void>|undefined;
export async function chatPrice(id:string):Promise<ChatPrice>{
 if(!isAgentModel(id))throw new AppError(400,"Model is not supported.");
 if(!cache||cache.expires<Date.now()){
  catalogRequest??=remoteJson<{data:CatalogModel[]}>("https://openrouter.ai/api/v1/models").then(r=>{cache={models:r.data,expires:Date.now()+60000}}).finally(()=>{catalogRequest=undefined});
  await catalogRequest;
 }
 const model=cache?.models.find(m=>m.id===id),p=Number(model?.pricing.prompt),c=Number(model?.pricing.completion);
 if(!model||!Number.isFinite(p)||!Number.isFinite(c)||p<0||c<0||!model.supported_parameters.includes("response_format")||Object.entries(model.pricing).some(([k,v])=>!["prompt","completion","input_cache_read","input_cache_write"].includes(k)&&Number(v)>0))throw new AppError(503,"Model pricing or structured output is unavailable. No model call was made.");
 const efforts=model.reasoning?.supported_efforts;
 const canSetLow=model.supported_parameters.includes('reasoning')&&(efforts===null||efforts?.includes('low'));
 return {id,prompt:p,completion:c,...(canSetLow?{reasoningEffort:'low' as const}:{})};
}
// Bound input by UTF-8 bytes plus chat framing, and outputs including reasoning by max_tokens.
// Q&A/planner input is capped at 32 KB; the independent plan guard allows 64 KB.
// Reservations use the same input/output bounds as their requests.
export function callCeiling(price:ChatPrice,maxOutputTokens=800,maxInputBytes=32000){return Math.ceil((price.prompt*(maxInputBytes+8000)+price.completion*maxOutputTokens)*1e6)+10}
export async function chatCompletion(price:ChatPrice,system:string,data:unknown,maxOutputTokens=800,maxInputBytes=32000,audit?:UsageContext){
 const messages=[{role:"system",content:system},{role:"user",content:JSON.stringify(data)}];
 if(new TextEncoder().encode(JSON.stringify(messages)).length>maxInputBytes)throw new AppError(413,"Chat context is too large.");
 if(!env.OPENROUTER_API_KEY)throw new AppError(412,"SHEN's shared OpenRouter account is not configured.");
 const planning=audit?.kind==='planner'||audit?.kind==='plan-guard',influencer=audit?.kind?.startsWith('influencer');
 // Reasoning shares max_tokens with the answer, so every call asks for low effort
 // where supported; planning may use most of its larger output budget.
 const r=await remoteJson<{choices:{finish_reason:string;message:{content:string;tool_calls?:unknown;function_call?:unknown}}[];id?:string;usage?:{cost?:number;prompt_tokens?:number;completion_tokens?:number}}>("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{Authorization:"Bearer "+env.OPENROUTER_API_KEY,"Content-Type":"application/json","X-Title":planning?"SHEN agent planning":influencer?"SHEN AI influencer":"SHEN read-only Q&A"},body:JSON.stringify({model:price.id,messages,max_tokens:maxOutputTokens,...(price.reasoningEffort?{reasoning:{effort:price.reasoningEffort}}:{}),temperature:0,response_format:{type:"json_object"},provider:{require_parameters:true,allow_fallbacks:false,max_price:{prompt:price.prompt*1e6,completion:price.completion*1e6,request:0}}})},planning?60000:45000);
 if(audit)await recordModelUsage(audit,price,r,callCeiling(price,maxOutputTokens,maxInputBytes));
 if(typeof r?.usage?.cost!=="number"||!Number.isFinite(r.usage.cost)||r.usage.cost<0)throw new AppError(503,"Chat cost is awaiting reconciliation.");
 const cost=Math.ceil(r.usage.cost*1e6);
 if(!Number.isSafeInteger(cost)||cost>callCeiling(price,maxOutputTokens,maxInputBytes))throw new AppError(503,"Chat cost is awaiting reconciliation.");
 const choice=Array.isArray(r.choices)&&r.choices.length===1?r.choices[0]:undefined;
 if(!choice||choice.finish_reason!=="stop"||choice.message?.tool_calls||choice.message?.function_call||typeof choice.message?.content!=="string")throw new PaidCompletionRejected(cost,choice?.finish_reason==='length');
 return {text:choice.message.content,cost};
}

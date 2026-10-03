import { env } from "cloudflare:workers";
import { AppError, remoteJson } from "./server";
import { isAgentModel } from "./agent-models";

type CatalogModel={id:string;pricing:Record<string,string>;supported_parameters:string[]};
export type ChatPrice={id:string;prompt:number;completion:number};
let cache:{expires:number;models:CatalogModel[]}|undefined;
export async function chatPrice(id:string):Promise<ChatPrice>{
 if(!isAgentModel(id))throw new AppError(400,"Model is not supported.");
 if(!cache||cache.expires<Date.now()){const r=await remoteJson<{data:CatalogModel[]}>("https://openrouter.ai/api/v1/models");cache={models:r.data,expires:Date.now()+60000}}
 const model=cache.models.find(m=>m.id===id),p=Number(model?.pricing.prompt),c=Number(model?.pricing.completion);
 if(!model||!Number.isFinite(p)||!Number.isFinite(c)||p<0||c<0||!model.supported_parameters.includes("response_format")||Object.entries(model.pricing).some(([k,v])=>!["prompt","completion","input_cache_read","input_cache_write"].includes(k)&&Number(v)>0))throw new AppError(503,"Model pricing or structured output is unavailable. No model call was made.");
 return {id,prompt:p,completion:c};
}
// Bound input by UTF-8 bytes plus chat framing, and outputs including reasoning by max_tokens.
// Each input is capped below 32 KB; provider routes must honor the quoted token prices.
export function callCeiling(price:ChatPrice){return Math.ceil((price.prompt*40000+price.completion*800)*1e6)+10}
export async function chatCompletion(price:ChatPrice,system:string,data:unknown){
 const messages=[{role:"system",content:system},{role:"user",content:JSON.stringify(data)}];
 if(new TextEncoder().encode(JSON.stringify(messages)).length>32000)throw new AppError(413,"Chat context is too large.");
 if(!env.OPENROUTER_API_KEY)throw new AppError(412,"SHEN's shared OpenRouter account is not configured.");
 const r=await remoteJson<{choices:{finish_reason:string;message:{content:string;tool_calls?:unknown;function_call?:unknown}}[];usage?:{cost?:number}}>("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{Authorization:"Bearer "+env.OPENROUTER_API_KEY,"Content-Type":"application/json","X-Title":"SHEN read-only Q&A"},body:JSON.stringify({model:price.id,messages,max_tokens:800,temperature:0,response_format:{type:"json_object"},provider:{require_parameters:true,allow_fallbacks:false,max_price:{prompt:price.prompt*1e6,completion:price.completion*1e6,request:0}}})});
 const choice=r.choices?.[0];
 if(!choice||choice.finish_reason!=="stop"||choice.message.tool_calls||choice.message.function_call||typeof choice.message.content!=="string")throw new AppError(503,"The answer could not be verified. No action was taken.");
 if(typeof r.usage?.cost!=="number"||!Number.isFinite(r.usage.cost)||r.usage.cost<0)throw new AppError(503,"Chat cost is awaiting reconciliation.");
 return {text:choice.message.content,cost:Math.ceil(r.usage.cost*1e6)};
}

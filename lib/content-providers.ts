import { IMAGE_MODEL, supportedImageModels } from './content-policy.ts';
export class ProviderFailure extends Error{uncertain:boolean;cost:number|null;httpStatus:number|null;constructor(uncertain=true,cost:number|null=null,httpStatus:number|null=null){super('Provider result needs review. No automatic write retry will be attempted.');this.uncertain=uncertain;this.cost=cost;this.httpStatus=httpStatus}}
type Fetcher=typeof fetch;
type Pricing={billable:string;unit:string;cost_usd:number;variant?:string};
type Endpoint={provider_tag:string;pricing:Pricing[];supported_parameters:Record<string,{values?:string[]}>};
export type ImageQuote={model:string;provider:string;cost:number;ceiling:number};
// Seedream 4.5 requires at least 2K, even though the router catalog advertises
// 1K too. Keep the request within both the model and live endpoint constraints.
const imageResolution=(model:string)=>model==='bytedance-seed/seedream-4.5'?'2K':'1K';
export async function imageQuote(model=IMAGE_MODEL,transport:Fetcher=fetch):Promise<ImageQuote>{
 if(!supportedImageModels.includes(model))throw Error('Unsupported image model');
 const r=await transport('https://openrouter.ai/api/v1/images/models/'+model+'/endpoints',{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new ProviderFailure(false,0);
 const catalog=await r.json() as {endpoints:Endpoint[]};
 const endpoint=catalog.endpoints.find(e=>e.provider_tag==='seed'&&e.supported_parameters.resolution?.values?.includes(imageResolution(model))&&e.supported_parameters.aspect_ratio?.values?.includes('1:1')&&e.pricing.some(p=>p.billable==='output_image'&&p.unit==='image'&&!p.variant)&&e.pricing.every(p=>p.cost_usd===0||(p.billable==='output_image'&&p.unit==='image'&&!p.variant)));
 const price=endpoint?.pricing.find(p=>p.billable==='output_image')?.cost_usd;
 if(!endpoint||typeof price!=='number'||!Number.isFinite(price)||price<=0||price>.1)throw new ProviderFailure(false,0);
 const cost=Math.ceil(price*1000000);return {model,provider:endpoint.provider_tag,cost,ceiling:Math.ceil(cost*1.25)};
}
export async function generateImage(apiKey:string,quote:ImageQuote,prompt:string,transport:Fetcher=fetch){
 let r:Response;try{r=await transport('https://openrouter.ai/api/v1/images',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','X-Title':'SHEN community artwork'},body:JSON.stringify({model:quote.model,prompt,n:1,resolution:imageResolution(quote.model),aspect_ratio:'1:1',provider:{only:[quote.provider],allow_fallbacks:false}}),redirect:'error',signal:AbortSignal.timeout(120000)});}catch{throw new ProviderFailure()}
 // Image API billing is all-or-nothing. A received 400 rejects the request;
 // a received 502 reports failed generation. Neither produced a billed image.
 // Transport timeouts and unrecognized responses still require reconciliation.
 if(!r.ok){const failed=r.status===400||r.status===502;throw new ProviderFailure(!failed,failed?0:null,r.status);}
 const value=await r.json() as {data?:{b64_json:string;media_type?:string}[];usage?:{cost?:number}};
 const usd=value.usage?.cost;if(typeof usd!=='number'||!Number.isFinite(usd)||usd<0)throw new ProviderFailure();const cost=Math.ceil(usd*1e6);
 if(cost>quote.ceiling||value.data?.length!==1)throw new ProviderFailure(true,cost);
 const raw=value.data[0];if(!raw||typeof raw.b64_json!=='string'||raw.b64_json.length>6666668||!/^[A-Za-z0-9+/]+={0,2}$/.test(raw.b64_json))throw new ProviderFailure(false,cost);
 let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(raw.b64_json),c=>c.charCodeAt(0))}catch{throw new ProviderFailure(false,cost)}
 const mime=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71?'image/png':bytes[0]===255&&bytes[1]===216?'image/jpeg':String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'?'image/webp':null;
 if(!mime||bytes.length<12||bytes.length>5000000||(raw.media_type&&raw.media_type!==mime))throw new ProviderFailure(false,cost);
 return {mime,base64:raw.b64_json,cost};
}

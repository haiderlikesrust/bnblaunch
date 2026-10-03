import { IMAGE_MODEL, supportedImageModels } from './content-policy.ts';
export class ProviderFailure extends Error{uncertain:boolean;cost:number|null;constructor(uncertain=true,cost:number|null=null){super('Provider result needs review. No automatic write retry will be attempted.');this.uncertain=uncertain;this.cost=cost}}
type Fetcher=typeof fetch;
const API='https://api.twitterapi.io';
export function xProvider(apiKey:string,transport:Fetcher=fetch){
 if(!apiKey)throw Error('X provider is not configured');
 async function request(path:string,body?:unknown,form?:FormData){let response:Response;try{response=await transport(API+path,{method:body===undefined&&!form?'GET':'POST',headers:{'X-API-Key':apiKey,...(form?{}:{'Content-Type':'application/json'})},...(form?{body:form}:body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(60000)});}catch{throw new ProviderFailure()}
  let result:Record<string,unknown>;try{result=await response.json() as Record<string,unknown>}catch{throw new ProviderFailure()}
  if(!response.ok||!result||typeof result!=='object'||Array.isArray(result))throw new ProviderFailure();return result;
 }
 const success=(v:Record<string,unknown>,field:string)=>{if(v.status!=='success'||typeof v[field]!=='string'||!v[field])throw new ProviderFailure();return v[field] as string;};
 return {
  async balance(){const r=await request('/oapi/my/info');const n=r.recharge_credits;if(typeof n!=='number'||!Number.isSafeInteger(n*10)||n<0)throw new ProviderFailure();return n*10;},
  async user(username:string){const r=await request('/twitter/user/info?userName='+encodeURIComponent(username));const data=r.data as {id?:string;userName?:string};if(r.status!=='success'||typeof data?.id!=='string'||!/^\d+$/.test(data.id)||typeof data.userName!=='string'||data.userName.toLowerCase()!==username.toLowerCase())throw new ProviderFailure();return {id:data.id,username:data.userName};},
  async login(input:{user_name:string;email:string;password:string;proxy:string;totp_secret?:string}){return success(await request('/twitter/user_login_v2',input),'login_cookie')},
  async upload(session:{loginCookies:string;proxy:string},file:File){const form=new FormData();form.append('file',file);form.append('login_cookies',session.loginCookies);form.append('proxy',session.proxy);return success(await request('/twitter/upload_media_v2',undefined,form),'media_id')},
  async post(session:{loginCookies:string;proxy:string},text:string,mediaId?:string|null){return success(await request('/twitter/create_tweet_v2',{login_cookies:session.loginCookies,proxy:session.proxy,tweet_text:text,...(mediaId?{media_ids:[mediaId]}:{})}),'tweet_id')},
  async tweets(userId:string,id?:string){const r=await request(id?'/twitter/tweets?tweet_ids='+encodeURIComponent(id):'/twitter/user/last_tweets?userId='+encodeURIComponent(userId)+'&includeReplies=true');const nested=r.data as {tweets?:unknown[]}|undefined;const tweets=Array.isArray(r.tweets)?r.tweets:nested?.tweets;if(r.status!=='success'||!Array.isArray(tweets))throw new ProviderFailure();return tweets;},
 };
}
type Pricing={billable:string;unit:string;cost_usd:number;variant?:string};
type Endpoint={provider_tag:string;pricing:Pricing[];supported_parameters:Record<string,{values?:string[]}>};
export type ImageQuote={model:string;provider:string;cost:number;ceiling:number};
export async function imageQuote(model=IMAGE_MODEL,transport:Fetcher=fetch):Promise<ImageQuote>{
 if(!supportedImageModels.includes(model))throw Error('Unsupported image model');
 const r=await transport('https://openrouter.ai/api/v1/images/models/'+model+'/endpoints',{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new ProviderFailure(false,0);
 const catalog=await r.json() as {endpoints:Endpoint[]};
 const endpoint=catalog.endpoints.find(e=>e.provider_tag==='seed'&&e.supported_parameters.resolution?.values?.includes('1K')&&e.supported_parameters.aspect_ratio?.values?.includes('1:1')&&e.pricing.some(p=>p.billable==='output_image'&&p.unit==='image'&&!p.variant)&&e.pricing.every(p=>p.cost_usd===0||(p.billable==='output_image'&&p.unit==='image'&&!p.variant)));
 const price=endpoint?.pricing.find(p=>p.billable==='output_image')?.cost_usd;
 if(!endpoint||typeof price!=='number'||!Number.isFinite(price)||price<=0||price>.1)throw new ProviderFailure(false,0);
 const cost=Math.ceil(price*1000000);return {model,provider:endpoint.provider_tag,cost,ceiling:Math.ceil(cost*1.25)};
}
export async function generateImage(apiKey:string,quote:ImageQuote,prompt:string,transport:Fetcher=fetch){
 let r:Response;try{r=await transport('https://openrouter.ai/api/v1/images',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','X-Title':'SHEN community artwork'},body:JSON.stringify({model:quote.model,prompt,n:1,resolution:'1K',aspect_ratio:'1:1',provider:{only:[quote.provider],allow_fallbacks:false}}),redirect:'error',signal:AbortSignal.timeout(120000)});}catch{throw new ProviderFailure()}
 if(!r.ok)throw new ProviderFailure(r.status!==502,r.status===502?0:null);
 const value=await r.json() as {data?:{b64_json:string;media_type?:string}[];usage?:{cost?:number}};
 const usd=value.usage?.cost;if(typeof usd!=='number'||!Number.isFinite(usd)||usd<0)throw new ProviderFailure();const cost=Math.ceil(usd*1e6);
 if(cost>quote.ceiling||value.data?.length!==1)throw new ProviderFailure(true,cost);
 const raw=value.data[0];if(!raw||typeof raw.b64_json!=='string'||raw.b64_json.length>6666668||!/^[A-Za-z0-9+/]+={0,2}$/.test(raw.b64_json))throw new ProviderFailure(false,cost);
 let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(raw.b64_json),c=>c.charCodeAt(0))}catch{throw new ProviderFailure(false,cost)}
 const mime=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71?'image/png':bytes[0]===255&&bytes[1]===216?'image/jpeg':String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'?'image/webp':null;
 if(!mime||bytes.length<12||bytes.length>5000000||(raw.media_type&&raw.media_type!==mime))throw new ProviderFailure(false,cost);
 return {mime,base64:raw.b64_json,cost};
}

import { env } from 'cloudflare:workers';

// Higgsfield's asynchronous generation API: submit, then poll the request.
// https://docs.higgsfield.ai/docs/concepts/requests
const API='https://api.higgsfield.ai';
type Fetcher=typeof fetch;
export const SOUL_PATH='/higgsfield-ai/soul/v2/standard';
export type GenerationStatus='queued'|'in_progress'|'completed'|'failed'|'nsfw'|'canceled';
export type Generation={status:GenerationStatus;requestId:string;imageUrl:string|null;videoUrl:string|null};
const STATUSES:GenerationStatus[]=['queued','in_progress','completed','failed','nsfw','canceled'];
const ID=/^[A-Za-z0-9-]{8,100}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A received 4xx rejected the request before generation; nothing was billed.
export class HiggsfieldRejected extends Error{readonly status:number;constructor(status:number){super('Higgsfield rejected the request.');this.status=status;}}
// Network errors, timeouts, 429 and 5xx leave the outcome unknown. Callers
// retry a submission with its original Idempotency-Key, never a fresh one.
export class HiggsfieldPending extends Error{readonly status:number|null;constructor(status:number|null=null){super('Higgsfield result is pending.');this.status=status;}}

export function higgsfieldCredentials(){
 // The API console supplies one complete credential; preserve it as copied.
 const key=env.HIGGSFIELD_API_KEY?.trim();
 if(key)return /^[\x21-\x7e]{8,1024}$/.test(key)?key:null;
 const id=env.HIGGSFIELD_API_KEY_ID?.trim(),secret=env.HIGGSFIELD_API_KEY_SECRET?.trim();
 return id&&secret&&/^[^\s:]{4,200}$/.test(id)&&/^\S{8,400}$/.test(secret)?id+':'+secret:null;
}
// Provider media URLs are fetched server-side, so only public HTTPS hosts pass.
export function safeMediaUrl(value:unknown){
 if(typeof value!=='string'||value.length>2048)return null;
 try{
  const url=new URL(value),host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443'))return null;
  if(!host.includes('.')||host.includes(':')||host.startsWith('[')||/^[\d.]+$/.test(host)||host==='localhost'||/\.(local|internal|localhost)$/.test(host))return null;
  return url.href;
 }catch{return null}
}
async function request(path:string,init:RequestInit,transport:Fetcher){
 const credentials=higgsfieldCredentials();if(!credentials)throw new HiggsfieldRejected(401);
 let response:Response;
 try{response=await transport(API+path,{...init,headers:{...init.headers,Authorization:'Key '+credentials,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(30000)});}
 catch{throw new HiggsfieldPending();}
 if(response.status===429||response.status>=500)throw new HiggsfieldPending(response.status);
 if(!response.ok)throw new HiggsfieldRejected(response.status);
 try{return await response.json() as Record<string,unknown>}catch{throw new HiggsfieldPending(response.status);}
}
export async function submitGeneration(path:string,body:Record<string,unknown>,idempotencyKey:string,transport:Fetcher=fetch){
 if(!/^\/[a-z0-9][a-z0-9./-]*$/.test(path)||path.includes('..'))throw Error('Invalid generation path');
 const value=await request(path,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify(body)},transport);
 if(typeof value.request_id!=='string'||!ID.test(value.request_id))throw new HiggsfieldPending();
 return value.request_id;
}
export async function generation(requestId:string,transport:Fetcher=fetch):Promise<Generation>{
 if(!ID.test(requestId))throw new HiggsfieldRejected(400);
 const value=await request('/requests/'+requestId+'/status',{method:'GET'},transport);
 const status=value.status as GenerationStatus;if(!STATUSES.includes(status))throw new HiggsfieldPending();
 const images=Array.isArray(value.images)?value.images as {url?:unknown}[]:[],video=value.video as {url?:unknown}|undefined;
 return {status,requestId,imageUrl:safeMediaUrl(images[0]?.url),videoUrl:safeMediaUrl(video?.url)};
}
// Soul ID custom reference: one trained identity reused by every generation.
export async function createCharacter(name:string,imageUrls:string[],idempotencyKey:string,transport:Fetcher=fetch){
 const images=imageUrls.map(safeMediaUrl);if(!images.length||images.some(v=>!v))throw new HiggsfieldRejected(400);
 const value=await request('/v1/custom-references',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify({name:name.slice(0,100),model_version:'v2',input_images:images.map(image_url=>({type:'image_url',image_url}))})},transport);
 if(typeof value.id!=='string'||!UUID.test(value.id))throw new HiggsfieldPending();
 return value.id;
}
export async function characterState(id:string,transport:Fetcher=fetch):Promise<'training'|'ready'|'failed'>{
 if(!UUID.test(id))throw new HiggsfieldRejected(400);
 const value=await request('/v1/custom-references/'+id,{method:'GET'},transport);
 if(value.status==='completed')return 'ready';
 if(value.status==='failed')return 'failed';
 if(['not_ready','queued','in_progress'].includes(String(value.status)))return 'training';
 throw new HiggsfieldPending();
}
// Presigned upload. Higgsfield credentials never go to the storage URL.
export async function uploadMedia(bytes:Uint8Array<ArrayBuffer>,mime:'image/png'|'image/jpeg'|'image/webp',transport:Fetcher=fetch){
 const value=await request('/files/generate-upload-url',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content_type:mime})},transport);
 const publicUrl=safeMediaUrl(value.public_url),uploadUrl=safeMediaUrl(value.upload_url);
 if(!publicUrl||!uploadUrl)throw new HiggsfieldPending();
 const headers=new Headers({'Content-Type':mime});
 if(value.upload_headers&&typeof value.upload_headers==='object')for(const [name,header] of Object.entries(value.upload_headers))if(typeof header==='string'&&/^[A-Za-z0-9-]{1,80}$/.test(name)&&!/^(authorization|cookie|host)$/i.test(name))headers.set(name,header);
 let response:Response;
 try{response=await transport(uploadUrl,{method:'PUT',headers,body:bytes,redirect:'error',signal:AbortSignal.timeout(60000)});}catch{throw new HiggsfieldPending();}
 if(response.status===429||response.status>=500)throw new HiggsfieldPending(response.status);
 if(!response.ok)throw new HiggsfieldRejected(response.status);
 return publicUrl;
}
export function mediaType(bytes:Uint8Array){
 if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)return 'image/png';
 if(bytes[0]===255&&bytes[1]===216)return 'image/jpeg';
 if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';
 if(String.fromCharCode(...bytes.slice(4,8))==='ftyp')return 'video/mp4';
 return null;
}
// Bounded download of a generated file. Each redirect is revalidated.
export async function downloadMedia(url:string,kind:'image'|'video',maxBytes:number,transport:Fetcher=fetch){
 let target=safeMediaUrl(url),response:Response|undefined;
 for(let hop=0;target&&hop<4;hop++){
  try{response=await transport(target,{redirect:'manual',signal:AbortSignal.timeout(kind==='video'?120000:45000)});}catch{throw new HiggsfieldPending();}
  if(response.status<300||response.status>=400)break;
  target=safeMediaUrl(response.headers.get('location')?new URL(response.headers.get('location')!,target).href:null);response=undefined;
 }
 if(!response)throw new HiggsfieldRejected(400);
 if(response.status===429||response.status>=500)throw new HiggsfieldPending(response.status);
 if(!response.ok)throw new HiggsfieldRejected(response.status);
 if(Number(response.headers.get('content-length')??0)>maxBytes)throw new HiggsfieldRejected(413);
 const reader=response.body?.getReader(),parts:Uint8Array[]=[];let size=0;
 if(!reader)throw new HiggsfieldPending();
 try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>maxBytes){await reader.cancel();throw new HiggsfieldRejected(413);}parts.push(chunk.value);}}
 catch(error){if(error instanceof HiggsfieldRejected)throw error;throw new HiggsfieldPending();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
 const mime=mediaType(bytes);
 if(!mime||bytes.length<12||(kind==='video')!==(mime==='video/mp4'))throw new HiggsfieldRejected(415);
 return {bytes,mime};
}
export function soulImage(prompt:string,options:{characterId?:string|null;aspect:'3:4'|'9:16'|'1:1'}){
 if(options.characterId&&!UUID.test(options.characterId))throw new HiggsfieldRejected(400);
 return {prompt:prompt.slice(0,3000),aspect_ratio:options.aspect,resolution:'1080p',enhance_prompt:false,batch_size:1,...(options.characterId?{custom_reference_id:options.characterId,custom_reference_strength:0.9}:{})};
}
// Image-to-video models documented by Higgsfield. Five-second clips.
const VIDEO_MODELS={
 kling:{path:'/kling-video/v3.0/std/image-to-video',body:(image:string,prompt:string)=>({image_url:image,prompt:prompt.slice(0,2500),duration:5,sound:'on',cfg_scale:0.5})},
 seedance:{path:'/bytedance/seedance-2.0/image-to-video',body:(image:string,prompt:string)=>({image_url:image,prompt:prompt||'Subtle natural motion.',duration:5,resolution:'720p',generate_audio:true})},
};
export function videoModel(){return VIDEO_MODELS[env.HIGGSFIELD_VIDEO_MODEL==='seedance'?'seedance':'kling'];}

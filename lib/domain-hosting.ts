import { normalizeCustomDomain, publicIpv4 } from '../shared/domain-host.mjs';

export type HostingConfig={dokployUrl:string;apiKey:string;composeId:string;ipv4:string};
export type PinnedRequest={domain:string;ipv4:string;path:string;maxBytes:number};
export type PinnedResponse={status:number;contentType:string;body:string};
type Dependencies={fetch?:typeof fetch;resolve4?:(domain:string)=>Promise<string[]>;resolve6?:(domain:string)=>Promise<string[]>;requestHttps?:(input:PinnedRequest)=>Promise<PinnedResponse>};
type Route={domainId:string;host:string;composeId:string;serviceName:string;port:number;path:string;https:boolean;certificateType:string;domainType:string;internalPath?:string|null;stripPath?:boolean;enabled?:boolean;middlewares?:unknown[]|null;forwardAuthEnabled?:boolean;applicationId?:string|null;previewDeploymentId?:string|null;customCertResolver?:string|null;customEntrypoint?:string|null};
export class HostingError extends Error{code:string;uncertain:boolean;constructor(code:string,message:string,uncertain=false){super(message);this.code=code;this.uncertain=uncertain;}}

export function validateHostingConfig(input:HostingConfig):HostingConfig{
 let url:URL;try{url=new URL(input.dokployUrl);}catch{throw new HostingError('configuration','Set DOKPLOY_URL to the HTTPS origin of your Dokploy instance.');}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new HostingError('configuration','DOKPLOY_URL must be an HTTPS origin without credentials or a path.');
 if(!input.apiKey||input.apiKey.length>1000||/[\r\n]/.test(input.apiKey)||!/^[-_a-zA-Z0-9]{1,100}$/.test(input.composeId))throw new HostingError('configuration','Set a Dokploy API key and the SHEN Compose ID.');
 if(!publicIpv4(input.ipv4))throw new HostingError('configuration','HOSTING_IPV4 must be your server’s public IPv4 address.');
 return {...input,dokployUrl:url.origin};
}

async function boundedJson(response:Response){
 const reader=response.body?.getReader();if(!reader)throw new Error('Empty response');
 let size=0,text='';const decoder=new TextDecoder();
 try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>1024*1024)throw new Error('Response too large');text+=decoder.decode(next.value,{stream:true});}text+=decoder.decode();return JSON.parse(text) as unknown;}finally{await reader.cancel().catch(()=>{});}
}

/** Real certificate verification stays enabled. The socket is pinned to the configured public IP,
 * while SNI/Host remain the purchased domain. A DNS rebinding cannot turn this into an internal fetch. */
export async function pinnedHttpsRequest(input:PinnedRequest):Promise<PinnedResponse>{
 const domain=normalizeCustomDomain(input.domain);if(!publicIpv4(input.ipv4)||!['/','/.well-known/shen-site'].includes(input.path))throw new HostingError('verification','Invalid public verification target.');
 const {request}=await import('node:https');
 return new Promise((resolve,reject)=>{
  const req=request({hostname:input.ipv4,port:443,servername:domain,path:input.path,method:'GET',rejectUnauthorized:true,agent:false,headers:{Host:domain,Accept:input.path==='/'?'text/html':'application/json','Accept-Encoding':'identity','User-Agent':'SHEN-Domain-Verification/1.0'}},res=>{
   let size=0;const chunks:Buffer[]=[];
   res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>input.maxBytes){req.destroy(new Error('Verification response too large'));return;}chunks.push(chunk);});
   res.once('error',reject);res.once('end',()=>resolve({status:res.statusCode??0,contentType:String(res.headers['content-type']??''),body:Buffer.concat(chunks).toString('utf8')}));
  });
  const timeout=setTimeout(()=>req.destroy(new Error('Verification timed out')),12_000);timeout.unref?.();req.once('close',()=>clearTimeout(timeout));req.once('error',reject);req.end();
 });
}

export function createDomainHosting(input:HostingConfig,dependencies:Dependencies={}){
 const config=validateHostingConfig(input),transport=dependencies.fetch??fetch;
 async function api(method:string,body?:Record<string,unknown>){
  const url=new URL('/api/'+method,config.dokployUrl);if(!body)url.searchParams.set('composeId',config.composeId);
  let response:Response;
  try{response=await transport(url,{method:body?'POST':'GET',headers:{'x-api-key':config.apiKey,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(20_000)});}catch{throw new HostingError('request_unknown','Dokploy request did not return a confirmed result.',!!body);}
  // Dokploy may commit a change before an audit or response step fails. Even a
  // non-2xx mutation response is reconciled, never interpreted as proof of no write.
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw new HostingError('provider_rejected',`Dokploy request failed (${response.status}).`,!!body);}
  try{return await boundedJson(response);}catch{throw new HostingError('response_unknown','Dokploy returned an unrecognized response.',!!body);}
 }
 function matchRoute(value:unknown,domain:string):Route{
  const route=value as Route;
  if(!route||typeof route!=='object'||typeof route.domainId!=='string'||!route.domainId||route.host!==domain||route.composeId!==config.composeId||route.serviceName!=='gateway'||route.port!==3187||route.path!=='/'||route.https!==true||route.certificateType!=='letsencrypt'||route.domainType!=='compose'||(route.internalPath??'/')!=='/'||(route.stripPath!==undefined&&route.stripPath!==false)||(route.enabled!==undefined&&route.enabled!==true)||(route.forwardAuthEnabled!==undefined&&route.forwardAuthEnabled!==false)||(route.middlewares!=null&&(!Array.isArray(route.middlewares)||route.middlewares.length>0))||route.applicationId||route.previewDeploymentId||route.customCertResolver||route.customEntrypoint)throw new HostingError('route_conflict','An existing domain route does not match SHEN hosting. No route was changed.');
  return route;
 }
 async function findRoute(domainInput:string){
  const domain=normalizeCustomDomain(domainInput),value=await api('domain.byComposeId');
  if(!Array.isArray(value))throw new HostingError('response_unknown','Dokploy domain list was not recognized.');
  const matches=value.filter(item=>item&&typeof item==='object'&&typeof item.host==='string'&&item.host.toLowerCase()===domain);
  if(matches.length>1)throw new HostingError('route_conflict','More than one route exists for this domain. No route was changed.');
  return matches.length?matchRoute(matches[0],domain):null;
 }
 async function ensureRoute(domainInput:string,options:{allowCreate:boolean}){
  const domain=normalizeCustomDomain(domainInput),existing=await findRoute(domain);if(existing)return {domainId:existing.domainId,created:false};
  if(!options.allowCreate)return null;
  // The caller must durably record its create attempt first. After an uncertain response,
  // call with allowCreate:false to reconcile; never issue a second blind create.
  try{const result=await api('domain.create',{host:domain,composeId:config.composeId,serviceName:'gateway',domainType:'compose',port:3187,path:'/',internalPath:'/',stripPath:false,https:true,certificateType:'letsencrypt',middlewares:[],forwardAuthEnabled:false});const route=matchRoute(result,domain);return {domainId:route.domainId,created:true};}
  catch(error){const recovered=await findRoute(domain).catch(()=>null);if(recovered)return {domainId:recovered.domainId,created:false};if(error instanceof HostingError){error.uncertain=true;throw error;}throw new HostingError('response_unknown','Domain creation requires reconciliation.',true);}
 }
 async function composeStatus(){
  const value=await api('compose.one') as {composeId?:unknown;composeType?:unknown;composeStatus?:unknown;deployments?:unknown[]};
  if(!value||value.composeId!==config.composeId||value.composeType!=='docker-compose'||!['idle','running','done','error'].includes(String(value.composeStatus)))throw new HostingError('response_unknown','The configured Dokploy Compose project was not recognized.');
  return {status:value.composeStatus as 'idle'|'running'|'done'|'error'};
 }
 async function queueDeployment(domainInput:string,operationId:string){
  const domain=normalizeCustomDomain(domainInput);if(!/^[-_a-zA-Z0-9:]{1,150}$/.test(operationId))throw new HostingError('configuration','Invalid deployment operation ID.');
  if(!await findRoute(domain))throw new HostingError('missing_route','Create the domain route before applying hosting.');
  if((await composeStatus()).status==='running')return {queued:false as const,reason:'busy' as const};
  // Persist a deployment attempt before invoking this method. Dokploy has no idempotency key.
  // Redeploy applies domain labels to the checked-out release; it does not fetch another commit.
  // No freshVolumes flag is ever sent. A lost response must be reconciled through HTTPS, not retried.
  const value=await api('compose.redeploy',{composeId:config.composeId,title:'SHEN domain '+domain,description:'Domain operation '+operationId});
  if(value!==true&&(!value||typeof value!=='object'||!('success' in value)||value.success!==true))throw new HostingError('response_unknown','Dokploy did not confirm the deployment request.',true);
  return {queued:true as const};
 }
 async function verifySite(domainInput:string,coinId:string,challenge:string){
  const domain=normalizeCustomDomain(domainInput);
  if(!/^[-_a-zA-Z0-9]{1,100}$/.test(coinId)||!/^[-_a-zA-Z0-9]{24,100}$/.test(challenge))throw new HostingError('verification','Invalid site verification identity.');
  try{
   const dns=dependencies.resolve4&&dependencies.resolve6?null:await import('node:dns/promises');
   const resolver=dns?new dns.Resolver({timeout:4000,tries:2}):null;
   const resolve4=dependencies.resolve4??((host:string)=>resolver!.resolve4(host)),resolve6=dependencies.resolve6??((host:string)=>resolver!.resolve6(host));
   const [addresses,ipv6]=await Promise.all([resolve4(domain),resolve6(domain).catch((error:unknown)=>{if(error&&typeof error==='object'&&'code' in error&&['ENODATA','ENOTFOUND'].includes(String(error.code)))return [];throw error;})]);
   if(!addresses.length||addresses.some(ip=>ip!==config.ipv4)||ipv6.length)return {live:false as const,reason:'DNS is not yet exclusively pointing to the SHEN hosting server.'};
   const request=dependencies.requestHttps??pinnedHttpsRequest;
   const proof=await request({domain,ipv4:config.ipv4,path:'/.well-known/shen-site',maxBytes:4096});
   if(proof.status!==200||!/^application\/json(?:;|$)/i.test(proof.contentType))return {live:false as const,reason:'The domain verification endpoint is not ready over HTTPS.'};
   const value=JSON.parse(proof.body) as Record<string,unknown>;
   if(!value||value.service!=='shen-site'||value.domain!==domain||value.coinId!==coinId||value.challenge!==challenge)return {live:false as const,reason:'The domain is not serving this agent’s verified website.'};
   const page=await request({domain,ipv4:config.ipv4,path:'/',maxBytes:512*1024});
   if(page.status!==200||!/^text\/html(?:;|$)/i.test(page.contentType)||!page.body.includes('data-shen-site="'+coinId+'"'))return {live:false as const,reason:'The published website is not ready at the domain root.'};
   return {live:true as const,reason:null};
  }catch{return {live:false as const,reason:'DNS, HTTPS certificate, or site verification is still pending.'};}
 }
 return {findRoute,ensureRoute,composeStatus,queueDeployment,verifySite};
}

import {customHostRoute,requestHostname} from '../shared/domain-host.mjs';

/** Wrap the framework's native request listener before it is exposed to the network. */
export function createHostRequestHandler({appOrigin,lookupDomain,now=Date.now},next){
 const origin=new URL(appOrigin),primary=requestHostname(origin.host);
 if(!primary||!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw Error('APP_ORIGIN must be the application origin');
 const send=(req,res,status,body,type='text/plain; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:body);};
 return async(req,res)=>{
  try{
   const host=requestHostname(req.headers.host);
   if(!host||typeof req.url!=='string'||!req.url.startsWith('/')||req.url.startsWith('//')||req.url.includes('\\'))return send(req,res,400,'Invalid request');
   // No proxy-supplied authority or previous custom routing hint is accepted from a caller.
   delete req.headers['x-forwarded-host'];delete req.headers.forwarded;delete req.headers['x-shen-domain'];delete req.headers['x-shen-coin'];
   if(host===primary)return next(req,res);
   const pathname=req.url.split('?')[0];
   if(['web','localhost','127.0.0.1'].includes(host)){
    if(pathname==='/api/health'||host==='web'&&pathname==='/api/internal/worker')return next(req,res);
    return send(req,res,404,'Not found');
   }
   if(req.method!=='GET'&&req.method!=='HEAD')return send(req,res,404,'Not found');
   const mapping=await lookupDomain(host);
   if(!mapping||mapping.domain!==host||!['provisioning','live','degraded'].includes(mapping.state)||mapping.expires_at!=null&&mapping.expires_at<=now()||!/^[-_a-zA-Z0-9]{1,100}$/.test(mapping.coin_id)||!/^[-_a-zA-Z0-9]{24,100}$/.test(mapping.verification_token))return send(req,res,404,'Not found');
   const kind=customHostRoute(pathname,mapping.coin_id);
   if(kind==='blocked')return send(req,res,404,'Not found');
   // Custom sites have no wallet session or account-management capabilities.
   for(const name of ['cookie','authorization','oai-authenticated-user-id','oai-authenticated-user-email','next-action'])delete req.headers[name];
   if(kind==='verification')return send(req,res,200,JSON.stringify({service:'shen-site',domain:host,coinId:mapping.coin_id,challenge:mapping.verification_token}),'application/json; charset=utf-8');
   if(kind==='site')req.url='/sites/'+mapping.coin_id;
   res.setHeader('X-Shen-Site',mapping.coin_id);
   return next(req,res);
  }catch{
   if(!res.headersSent)send(req,res,503,'Website temporarily unavailable');else res.destroy();
  }
 };
}

export const domainHostLookupSql=`SELECT d.coin_id,d.domain,d.state,d.verification_token,d.expires_at
 FROM coin_domains d JOIN coins c ON c.id=d.coin_id
 WHERE d.domain=$1 AND c.token_address IS NOT NULL
 AND EXISTS(SELECT 1 FROM site_revisions s WHERE s.coin_id=d.coin_id)`;

export async function installHostRouting(server,options){
 const listeners=server.listeners('request');
 if(listeners.length!==1)throw Error('Unsupported production request listener configuration');
 server.removeAllListeners('request');
 server.on('request',createHostRequestHandler(options,(req,res)=>listeners[0].call(server,req,res)));
}

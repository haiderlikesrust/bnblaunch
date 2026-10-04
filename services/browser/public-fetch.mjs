import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

const blocked=new BlockList();
for(const [ip,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])blocked.addSubnet(ip,prefix,'ipv4');
export const publicAddress=ip=>isIP(ip)===4&&!blocked.check(ip,'ipv4');
export function publicUrl(value){
  const u=new URL(value);
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port||u.hostname.endsWith('.')||!u.hostname.includes('.')||isIP(u.hostname)&&!publicAddress(u.hostname))throw Error('Public web URL required');
  if(/(^|\.)(localhost|local|internal|test|invalid|example)$/.test(u.hostname))throw Error('Private domain');
  return u;
}
// Chromium never connects to a target itself. Resolve, validate, then pin the
// validated address in the outbound connection, including every redirect.
export async function publicFetch(value,budget,{resolve=lookup}={}){
  const u=publicUrl(value);
  const answers=await resolve(u.hostname,{family:4,all:true});
  if(!answers.length||answers.some(a=>!publicAddress(a.address)))throw Error('Non-public DNS');
  if(++budget.requests>70||budget.bytes>10000000||Date.now()>budget.deadline)throw Error('Page budget exhausted');
  return new Promise((accept,reject)=>{
    const req=(u.protocol==='https:'?httpsRequest:httpRequest)(u,{method:'GET',agent:false,lookup:(_host,options,cb)=>options.all?cb(null,[{address:answers[0].address,family:4}]):cb(null,answers[0].address,4),headers:{'User-Agent':'SHEN-Research/1.0 (read-only public research)','Accept':'text/html,text/css,image/*;q=0.9,*/*;q=0.1','Accept-Encoding':'identity'},signal:AbortSignal.timeout(6000)},res=>{
      const type=String(res.headers['content-type']??'').split(';')[0].toLowerCase();
      if([301,302,303,307,308].includes(res.statusCode)&&res.headers.location){res.resume();accept({redirect:new URL(res.headers.location,u).href,status:res.statusCode});return;}
      if(!['text/html','text/css','image/png','image/jpeg','image/webp','image/gif','image/svg+xml','font/woff','font/woff2','application/font-woff'].includes(type)){res.destroy();reject(Error('Unsupported page resource'));return;}
      let size=0;const chunks=[];
      res.on('data',chunk=>{size+=chunk.length;budget.bytes+=chunk.length;if(size>2000000||budget.bytes>10000000){res.destroy(Error('Resource too large'));return;}chunks.push(chunk);});
      res.on('error',reject);res.on('end',()=>accept({status:res.statusCode??502,type,body:Buffer.concat(chunks)}));
    });req.on('error',reject);req.end();
  });
}

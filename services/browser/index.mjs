import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { chromium } from 'playwright';
import { capturePage } from './render.mjs';
const token=process.env.BROWSER_TOKEN??'';let busy=false,ready=false;
if(token.length>=40)try{const probe=await chromium.launch({headless:true,chromiumSandbox:true});await probe.close();ready=true;}catch{console.warn('Browser sandbox could not start. Check host user namespaces and the supplied seccomp profile.');}
const authorized=value=>{const a=Buffer.from(value??''),b=Buffer.from('Bearer '+token);return token.length>=40&&a.length===b.length&&timingSafeEqual(a,b)};
createServer(async(req,res)=>{
  const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(req.url==='/healthz')return send(ready?200:503,{ready});
  if(req.method!=='POST'||req.url!=='/capture'||!authorized(req.headers.authorization))return send(403,{error:'Unavailable'});
  if(!ready)return send(503,{error:'Browser unavailable'});
  if(busy)return send(429,{error:'Browser busy'});
  busy=true;
  try{let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw Error('Body too large');}
    const input=JSON.parse(body);if(Object.keys(input).join()!=='url'||typeof input.url!=='string'||input.url.length>2048)throw Error('Invalid request');
    send(200,await capturePage(input.url));
  }catch{send(502,{error:'Public page could not be captured'});}finally{busy=false;}
}).listen(Number(process.env.PORT??8090),'0.0.0.0');

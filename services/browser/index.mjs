import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { chromium } from 'playwright';
import { capturePage } from './render.mjs';
const token=process.env.BROWSER_TOKEN??'';let busy=false,ready=false,failures=0;
// The sandbox probe runs after the server listens, so health checks get a 503
// rather than connection refused, and retries with backoff instead of once.
async function probe(){
  try{const browser=await chromium.launch({headless:true,chromiumSandbox:true,timeout:60000});await browser.close();ready=true;failures=0;console.log('Browser sandbox ready.');}
  catch(error){
    ready=false;failures++;
    console.warn(`Browser sandbox could not start (attempt ${failures}). Check host user namespaces and the supplied seccomp profile.`);
    // Startup has no page input or authentication headers. Keep the native
    // diagnostic in container logs, never in the public health response.
    console.warn(String(error instanceof Error?error.message:error).split(token).join('[redacted]').slice(0,6000));
    // Compose restarts exited containers, not unhealthy ones: exit so a fresh
    // container retries once repeated probes in this one have failed.
    if(failures>=5){console.warn('Browser sandbox is still unavailable; exiting so the container restarts.');process.exit(1);}
    setTimeout(()=>void probe(),Math.min(60000,5000*2**failures)).unref();
  }
}
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
}).listen(Number(process.env.PORT??8090),'0.0.0.0',()=>{
  if(token.length>=40)void probe();
  else console.warn('BROWSER_TOKEN is missing or shorter than 40 characters; the research browser stays disabled and unhealthy.');
});

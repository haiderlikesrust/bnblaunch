import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const env=process.env;
for(const name of ['SHEN_APP_URL','WORKER_TOKEN','SIGNER_WORKER_TOKEN']) if(!env[name]||((name.endsWith('TOKEN'))&&env[name].length<40)) throw Error(name+' is required');
const app=new URL(env.SHEN_APP_URL),signer=new URL(env.SIGNER_INTERNAL_URL??'http://signer:8080');
if((app.protocol!=='https:'&&!(app.protocol==='http:'&&app.hostname==='web'&&app.port==='3000'))||app.username||app.password) throw Error('Only the private web service may use HTTP');
if(signer.protocol!=='https:'&&!(signer.protocol==='http:'&&signer.hostname==='signer')) throw Error('Only the private signer service may use HTTP');
let stopping=false,lastSuccess=0;
async function request(base,path,token,data,site=false){
  const response=await fetch(new URL(path,base),{method:data===undefined?'GET':'POST',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(site&&env.SHEN_SITE_ACCESS_TOKEN?{'OAI-Sites-Authorization':'Bearer '+env.SHEN_SITE_ACCESS_TOKEN}:{})},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw Error('Service returned HTTP '+response.status);
  return response.json();
}
const site=(data)=>request(app,'/api/internal/worker',env.WORKER_TOKEN,data,true);
async function cycle(){
  try{await site({action:'index'});}catch{console.warn('Curve indexing awaits an available canonical RPC range.');}
  const authority=await request(signer,'/v1/status',env.SIGNER_WORKER_TOKEN);
  if(!authority.signingReady||!authority.workerAuthorized||authority.chainId!==56)throw Error('Worker signing authority unavailable');
  const {operations,domainFunding=[]}=await site();
  for(const job of domainFunding){
    if(stopping)break;
    try{await request(signer,"/v1/domain-funding",env.SIGNER_WORKER_TOKEN,job);await request(signer,`/v1/domain-funding/${job.id}/tick`,env.SIGNER_WORKER_TOKEN,{});lastSuccess=Date.now();}catch{console.warn("Domain funding awaits reconciliation; its saved ID is retained.");}
  }
  for(const op of operations){
    if(stopping)break;
    try{
      // The immutable operation ID is reused after every timeout or restart.
      // Signer persistence determines whether to sign, replay or reconcile.
      if(['rewards','buyback_burn'].includes(op.kind)){
        const {campaign}=await request(signer,`/v1/campaigns/${op.id}/record`,env.SIGNER_WORKER_TOKEN);
        if(campaign||op.expiresAt>Date.now()){
          if(!campaign)await request(signer,'/v1/campaigns',env.SIGNER_WORKER_TOKEN,{id:op.id,coinId:op.coinId,kind:op.kind,amountWei:op.amountWei,expiresAt:op.expiresAt});
          await request(signer,`/v1/campaigns/${op.id}/tick`,env.SIGNER_WORKER_TOKEN,{});
        }
      }else{
      const {intent}=await request(signer,`/v1/intents/${op.id}/record`,env.SIGNER_WORKER_TOKEN);
      if(intent?.hash)await request(signer,`/v1/intents/${op.id}`,env.SIGNER_WORKER_TOKEN);
      else if(op.expiresAt>Date.now())await request(signer,`/v1/wallets/${op.coinId}/intent`,env.SIGNER_WORKER_TOKEN,{id:op.id,kind:op.kind,amountWei:op.amountWei,expiresAt:op.expiresAt});}
    }catch{console.warn('An agent operation awaits reconciliation. Its existing ID is retained.');}
    try{await site({action:'reconcile',id:op.id});}catch{console.warn('Operation settlement is pending.');}
  }
  await site({action:'domains'});
  await site({action:'tick'});lastSuccess=Date.now();
}
const health=createServer((_req,res)=>{const ok=Date.now()-lastSuccess<240000;res.writeHead(ok?200:503,{'Content-Type':'application/json'});res.end(JSON.stringify({ok}));});
health.listen(Number(env.PORT??8081),'0.0.0.0');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;health.close();});
while(!stopping){try{await cycle();}catch{console.warn('Agent worker could not finish this cycle. No success has been recorded.');}if(!stopping)await delay(15000);}

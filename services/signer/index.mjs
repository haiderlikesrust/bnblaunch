import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createPublicClient, http, isAddress, zeroAddress } from 'viem';
import { bsc, base } from 'viem/chains';
import { getOrderId } from '@relay-protocol/settlement-sdk';
import { DomainFunding } from './domain-funding.mjs';
import { WalletStore, authenticate } from './store.mjs';
import { Campaigns } from './campaigns.mjs';
import { SigningEngine } from './engine.mjs';
import { ProtocolFees } from './protocol-fees.mjs';
import { walletBalanceSnapshot } from './balance.mjs';

process.umask(0o077);
const env=process.env;
function required(name) {const value=env[name];if(!value) throw Error(name+' is required');return value;}
function positive(name) {const raw=required(name);if(!/^\d+$/.test(raw)||BigInt(raw)<=0n) throw Error(name+' must be a positive integer');return BigInt(raw);}
const webToken=required('SIGNER_WEB_TOKEN'),workerToken=required('SIGNER_WORKER_TOKEN');
if(webToken.length<40||workerToken.length<40||webToken===workerToken) throw Error('Use different high-entropy web and worker tokens (at least 40 characters)');
const rpc=required('BNB_RPC_URL');if(new URL(rpc).protocol!=='https:') throw Error('BNB_RPC_URL must use HTTPS');
const settlementAddress=required('SIGNER_SETTLEMENT_ADDRESS');
if(!isAddress(settlementAddress)||settlementAddress.toLowerCase()===zeroAddress) throw Error('Invalid settlement address');
const slippageBps=Number(positive('SIGNER_SLIPPAGE_BPS'));
if(slippageBps>300) throw Error('Slippage must be <=300 bps');
const storePath=resolve(env.SIGNER_DB_PATH??'/data/signer.sqlite');
mkdirSync(dirname(storePath),{recursive:true,mode:0o700});
const store=new WalletStore(storePath,required('SIGNER_MASTER_KEY'));
// The key now lives only inside the store; drop it from this process environment.
delete process.env.SIGNER_MASTER_KEY;
const client=createPublicClient({chain:bsc,transport:http(rpc,{timeout:12000,retryCount:1})});
const engine=new SigningEngine(store,client,{settlementAddress,slippageBps,gasReserveWei:positive('SIGNER_GAS_RESERVE_WEI'),maxGasPriceWei:positive('SIGNER_MAX_GAS_PRICE_WEI'),buybacksEnabled:env.SIGNER_BUYBACKS_ENABLED==='true'});
const campaigns=new Campaigns(store,engine);
const shenTokenAddress=env.SHEN_TOKEN_ADDRESS?.trim()||null;
if(shenTokenAddress&&(!isAddress(shenTokenAddress)||shenTokenAddress.toLowerCase()===zeroAddress))throw Error('Invalid SHEN_TOKEN_ADDRESS');
engine.policy.shenTokenAddress=shenTokenAddress;
const protocolFees=new ProtocolFees(store,engine,campaigns);
engine.protocolFees=protocolFees;
const domainFundingEnabled=env.DOMAIN_AUTO_FUNDING_ENABLED==='true';
if(domainFundingEnabled&&(!env.BASE_RPC_URL||new URL(env.BASE_RPC_URL).protocol!=='https:'||!env.PORKBUN_API_KEY||!env.PORKBUN_SECRET_KEY))throw Error('Domain funding requires HTTPS Base RPC and Porkbun credentials');
const baseClient=createPublicClient({chain:base,transport:http(env.BASE_RPC_URL??'https://mainnet.base.org',{timeout:12000,retryCount:1})});
const domainFunding=new DomainFunding(store,{bnbClient:client,baseClient,getOrderId,verifyLaunch:(coinId,hash)=>engine.bindLaunch(coinId,hash),protocolReserve:wallet=>engine.protocolReserve(wallet)},{enabled:domainFundingEnabled,porkbunApiKey:env.PORKBUN_API_KEY,porkbunSecretKey:env.PORKBUN_SECRET_KEY,relayApiKey:env.RELAY_API_KEY,gasReserveWei:engine.policy.gasReserveWei,maxGasPriceWei:engine.policy.maxGasPriceWei});
function send(res,status,value){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>8192) throw Error('Request too large');}return JSON.parse(raw);}
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k))) throw Error('Unsupported request fields');}
let inflight=0;
const server=createServer(async(req,res)=>{
  let path;
  try{path=new URL(req.url,'http://signer').pathname;}catch{return send(res,400,{error:'Invalid request target'});}
  if(path==='/healthz'&&req.method==='GET') return send(res,200,{ok:true});
  if(req.headers.origin) return send(res,403,{error:'Browser access is not supported'});
  const web=authenticate(req.headers.authorization,webToken),worker=authenticate(req.headers.authorization,workerToken);
  if(!web&&!worker) return send(res,401,{error:'Authentication required'});
  if(inflight>=20) return send(res,429,{error:'Signer is busy'});
  inflight++;
  try{
    if(path==='/v1/status'&&req.method==='GET') {
      await engine.chainReady();
      return send(res,200,{chainId:56,signingReady:true,domainFundingEnabled,workerAuthorized:worker,custody:'dedicated-agent-wallets',requiresDeveloperApproval:false,settlementAddress,gasReserveWei:engine.policy.gasReserveWei.toString(),buybacksEnabled:engine.policy.buybacksEnabled});
    }
    if(path==='/v1/protocol/tick'&&worker&&req.method==='POST'){exact(await body(req),[]);return send(res,200,await protocolFees.tick());}
    const protocolRecord=path.match(/^\/v1\/wallets\/([0-9a-f-]{36})\/protocol$/i);
    if(protocolRecord&&req.method==='GET'){
      const coinId=protocolRecord[1],fees=store.db.prepare('SELECT total_wei,checked_at FROM protocol_fees WHERE coin_id=?').get(coinId);
      const rows=store.db.prepare("SELECT id FROM campaigns WHERE coin_id=? AND kind='shen_buyback_burn' ORDER BY created_at DESC LIMIT 5").all(coinId);
      return send(res,200,{shareBps:1500,tokenAddress:shenTokenAddress,enabled:!!shenTokenAddress&&engine.policy.buybacksEnabled,fees:fees?{distributedWei:fees.total_wei,observedAt:fees.checked_at}:null,campaigns:rows.map(r=>campaigns.status(r.id))});
    }
    if(path==='/v1/campaigns'&&worker&&req.method==='POST')return send(res,200,{campaign:campaigns.start(await body(req))});
    const campaignRecord=path.match(/^\/v1\/campaigns\/([0-9a-f-]{36})\/record$/i);
    if(campaignRecord&&req.method==='GET')return send(res,200,{checkedAt:Date.now(),campaign:campaigns.status(campaignRecord[1])});
    const campaignTick=path.match(/^\/v1\/campaigns\/([0-9a-f-]{36})\/tick$/i);
    if(campaignTick&&worker&&req.method==='POST'){exact(await body(req),[]);return send(res,200,{campaign:await campaigns.tick(campaignTick[1])});}
    if(path==='/v1/domain-funding'&&worker&&req.method==='POST')return send(res,200,{job:domainFunding.start(await body(req))});
    const fundingRecord=path.match(/^\/v1\/domain-funding\/([0-9a-f-]{36})\/record$/i);
    if(fundingRecord&&req.method==='GET')return send(res,200,{job:domainFunding.status(fundingRecord[1])});
    const fundingTick=path.match(/^\/v1\/domain-funding\/([0-9a-f-]{36})\/tick$/i);
    if(fundingTick&&worker&&req.method==='POST'){exact(await body(req),[]);return send(res,200,{job:await domainFunding.tick(fundingTick[1])});}
    const match=path.match(/^\/v1\/wallets\/([0-9a-f-]{36})\/(provision|launch|balance|intent)$/i);
    if(match){const [,coinId,action]=match;
      if(action==='provision'&&web&&req.method==='POST'){exact(await body(req),[]);return send(res,200,store.provision(coinId));}
      if(action==='launch'&&web&&req.method==='POST'){const v=await body(req);exact(v,['hash']);if(!/^0x[0-9a-f]{64}$/i.test(v.hash)) throw Error('Invalid hash');return send(res,200,await engine.bindLaunch(coinId,v.hash));}
      if(action==='balance'&&req.method==='GET'){
        const wallet=store.wallet(coinId);if(!wallet) return send(res,404,{error:'Wallet not found'});
        return send(res,200,await walletBalanceSnapshot(wallet,engine,client,protocolFees));
      }
      if(action==='intent'&&worker&&req.method==='POST'){
        const v=await body(req);exact(v,['id','kind','amountWei','expiresAt']);
        return send(res,200,await engine.execute({...v,coinId}));
      }
      return send(res,403,{error:'This credential cannot perform that operation'});
    }
    const record=path.match(/^\/v1\/intents\/([0-9a-f-]{36})\/record$/i);
    if(record&&req.method==='GET'){
      store.expireUnsigned(record[1]);
      const row=store.intent(record[1]);return send(res,200,{checkedAt:Date.now(),intent:row?{id:row.id,coinId:row.coin_id,kind:row.kind,amountWei:row.amount_wei,status:row.status,hash:row.tx_hash,expiresAt:row.expires_at}:null});
    }
    const intent=path.match(/^\/v1\/intents\/([0-9a-f-]{36})$/i);
    if(intent&&worker&&req.method==='GET') return send(res,200,await engine.reconcile(intent[1]));
    return send(res,404,{error:'Endpoint not found'});
  }catch(e){
    // RPC errors can contain URL credentials or signed bytes. Never log them.
    const safe=e instanceof Error&&!('details' in e)&&!('shortMessage' in e)?e.message:'Chain operation unavailable; retry the same intent ID';
    send(res,409,{error:safe.slice(0,200)});
  }finally{inflight--;}
});
server.requestTimeout=20000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
server.listen(Number(env.PORT??8080),env.HOST??'0.0.0.0',()=>console.log('SHEN signing service listening'));
for(const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>{server.close(()=>{store.close();process.exit(0)});setTimeout(()=>process.exit(1),25000).unref();});

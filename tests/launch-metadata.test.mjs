import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CID} from 'multiformats/cid';
import {sha256} from 'multiformats/hashes/sha2';
import {privateKeyToAccount} from 'viem/accounts';
import {encodeAbiParameters,decodeFunctionData,parseEther,encodeErrorResult} from 'viem';
import {metadataCid} from '../lib/metadata-cid.ts';
register('./x-oauth-loader.mjs',import.meta.url);
const env=globalThis.__shenTestEnv={APP_ORIGIN:'https://shen.now',SHEN_RUNTIME:'node',SIGNER_URL:'http://signer:8080',SIGNER_WEB_TOKEN:'a'.repeat(48),BNB_RPC_URL:'https://rpc.invalid'};
const {POST:metadata}=await import('../app/api/coins/[id]/metadata/route.ts');
const {POST:launch}=await import('../app/api/coins/[id]/launch/route.ts');
const {publicCoin}=await import('../lib/public-coin.ts');
const {blankCoin}=await import('../lib/model.ts');
const {portalAbi,PORTAL}=await import('../lib/flap.ts');
const hash=await sha256.digest(new TextEncoder().encode('{"description":"metadata regression"}'));
const rawCid=CID.createV1(0x55,hash).toString(),dagCid=CID.createV1(0x70,hash).toString(),v0=CID.createV0(hash).toString();
test('metadata accepts CIDv0 and CIDv1 codecs, rejecting malformed identifiers and URLs',()=>{
 for(const cid of [rawCid,dagCid,v0])assert.equal(metadataCid.parse(cid),cid);
 assert.match(rawCid,/^bafk/);
 for(const cid of ['',null,{},'bafy'+'a'.repeat(40),rawCid.slice(0,-3),rawCid+'/metadata.json','https://example.com/'+rawCid,'ipfs://'+rawCid,' '+rawCid,'b'.repeat(257)])assert.equal(metadataCid.safeParse(cid).success,false);
});
for(const buy of ['0','0.025'])test(`saved image, raw CID and ${buy} BNB developer buy prepare without broadcast`,async()=>{
 const sql=new DatabaseSync(':memory:');
 for(const name of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+name,'utf8'));
 function prepare(query,args=[]){return {bind(...values){return prepare(query,values)},async run(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}}},async first(){return sql.prepare(query).get(...args)??null}}}
 env.DB={prepare,async batch(statements){return Promise.all(statements.map(s=>s.run()))}};
 const creator=privateKeyToAccount('0x'+'12'.repeat(32)),wallet='0x'+'ab'.repeat(20),id=crypto.randomUUID();
 const coin={...blankCoin,id,name:'Test',symbol:'TEST',description:'Metadata regression',imageUrl:`/api/coins/${id}/image`};
 sql.prepare('INSERT INTO coins(id,owner,config,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,creator.address.toLowerCase(),JSON.stringify(coin),'now','now');
 const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
 sql.prepare('INSERT INTO coin_images(coin_id,mime,base64) VALUES(?,?,?)').run(id,'image/png',Buffer.from(png).toString('base64'));
 const session='b'.repeat(64);
 sql.prepare('INSERT INTO wallet_sessions(id,wallet,expires_at) VALUES(?,?,?)').run(createHash('sha256').update(session).digest('hex'),creator.address.toLowerCase(),Date.now()+60000);
 globalThis.__xTestCookies={shen_session:session};
 const salt='0x0f735e321665009d7a32b353ccb4f2f5b7771e33c94c160e20c8be40e1e9f56e',address='0xF1636B3a44350AA4f6A7Ba9A5191D761a4A97777',originalFetch=globalThis.fetch;
 const tweet=buy==='0'?'':'https://x.com/shendotnow/status/123456789';
 let expectedTweet=null;
 let uploadResult=rawCid,uploads=0,balance=100n*10n**18n,revert=false,preparedTransaction,confirmValue,bindings=0,head="0x103",pending=false,receiptStatus="0x1";
 const txHash="0x"+"c".repeat(64),blockHash="0x"+"d".repeat(64);
 globalThis.fetch=async(input,init)=>{
  const url=String(input instanceof Request?input.url:input);
  if(url==='http://signer:8080/v1/status')return Response.json({chainId:56,signingReady:true});
  if(url===`http://signer:8080/v1/wallets/${id}/provision`)return Response.json({coinId:id,address:wallet,chainId:56});
  if(url===`http://signer:8080/v1/wallets/${id}/launch`){bindings++;return Response.json({address:wallet,tokenAddress:address,hash:txHash})}
  if(url==='https://funcs.flap.sh/api/upload'){
   uploads++;const form=init.body,operations=JSON.parse(form.get('operations'));
   assert.equal(operations.variables.meta.twitter,expectedTweet);
   assert.equal(operations.variables.meta.website,'https://shen.now/token/'+id);
   assert.equal(form.get('0').type,'image/png');
   return Response.json({data:{create:uploadResult}});
  }
  if(url==='https://rpc.invalid/'){
   const body=JSON.parse(input instanceof Request?await input.text():init.body);
   if(body.method==='eth_call'||body.method==='eth_estimateGas'){const tx=body.params[0],p=decodeFunctionData({abi:portalAbi,data:tx.data}).args[0];assert.equal(p.dexThresh,1);assert.equal(p.quoteAmt,parseEther(buy));assert.equal(BigInt(tx.value??'0x0'),parseEther(buy));}
   if(revert&&body.method==='eth_call')return Response.json({jsonrpc:'2.0',id:body.id,error:{code:3,message:'execution reverted',data:encodeErrorResult({abi:portalAbi,errorName:'InvalidDexThresholdType',args:[0]})}});
   const tx={hash:txHash,blockHash,blockNumber:'0x100',transactionIndex:'0x0',from:creator.address,to:PORTAL,gas:'0x100000',gasPrice:'0x3b9aca00',nonce:'0x0',input:preparedTransaction?.data??'0x',value:confirmValue??'0x0',type:'0x0',v:'0x1b',r:'0x'+'1'.repeat(64),s:'0x'+'2'.repeat(64)};
   const results={eth_getTransactionByHash:tx,eth_getTransactionReceipt:{transactionHash:txHash,transactionIndex:'0x0',blockHash,blockNumber:'0x100',from:creator.address,to:PORTAL,cumulativeGasUsed:'0x100000',gasUsed:'0x100000',effectiveGasPrice:'0x3b9aca00',contractAddress:null,logs:[],logsBloom:'0x'+'0'.repeat(512),status:receiptStatus,type:"0x0"},eth_blockNumber:head,eth_getBalance:'0x'+balance.toString(16),eth_gasPrice:'0x3b9aca00',eth_chainId:'0x38',eth_getCode:'0x',eth_call:encodeAbiParameters([{type:'address'}],[address]),eth_estimateGas:'0x100000'};
   if(pending&&['eth_getTransactionByHash','eth_getTransactionReceipt'].includes(body.method))return Response.json({jsonrpc:'2.0',id:body.id,result:null});
   assert.ok(Object.hasOwn(results,body.method),'Unexpected RPC method: '+body.method);
   return Response.json({jsonrpc:'2.0',id:body.id,result:results[body.method]});
  }
  throw Error('Unexpected external request: '+url);
 };
 const context={params:Promise.resolve({id})};
 const request=(path,data)=>new Request('https://shen.now/api/coins/'+id+'/'+path,{method:'POST',headers:{Origin:'https://shen.now','Content-Type':'application/json'},body:JSON.stringify(data)});
 try{
  const authorization=await launch(request('launch',{action:'authorize',creator:creator.address,initialBuyBnb:buy,tweetUrl:tweet}),context);
  assert.equal(authorization.status,200,await authorization.clone().text());
  const auth=await authorization.json();assert.match(auth.message,new RegExp('Developer buy: '+buy+' BNB'));const signature=await creator.signMessage({message:auth.message});
  expectedTweet=tweet||null;
  const missingAuth=await metadata(request('metadata',{useSavedImage:true,authorizationId:crypto.randomUUID()}),context);assert.equal(missingAuth.status,409);assert.equal(uploads,0);
  const uploaded=await metadata(request('metadata',{useSavedImage:true,authorizationId:auth.authorizationId}),context);
  assert.equal(uploaded.status,200);const {cid}=await uploaded.json();assert.equal(cid,rawCid);
  const payload={action:'prepare',authorizationId:auth.authorizationId,signature,cid,salt};
  const tampered=await launch(request('launch',{...payload,initialBuyBnb:'9'}),context);assert.equal(tampered.status,400);
  balance=0n;const insufficient=await launch(request('launch',payload),context);assert.equal(insufficient.status,422);assert.match((await insufficient.json()).error,/enough BNB/);
  balance=100n*10n**18n;revert=true;const rejected=await launch(request('launch',payload),context);assert.equal(rejected.status,422);assert.match((await rejected.json()).error,/threshold/);revert=false;
  const prepared=await launch(request('launch',payload),context);
  assert.equal(prepared.status,200,await prepared.clone().text());
  const result=await prepared.json();assert.equal(result.predictedAddress,address);assert.equal(BigInt(result.transaction.value),parseEther(buy));assert.equal(result.initialBuyBnb,buy);
  assert.equal(sql.prepare('SELECT initial_buy_wei FROM prepared_launches').get().initial_buy_wei,parseEther(buy).toString());
  assert.equal(uploads,1);
  expectedTweet=null;uploadResult='not-a-cid';const invalid=await metadata(request('metadata',{useSavedImage:true}),context);
  assert.equal(invalid.status,502);assert.match((await invalid.json()).error,/invalid metadata identifier/);
  preparedTransaction=result.transaction;confirmValue='0x'+(parseEther(buy)+1n).toString(16);
  pending=true;const unmined=await launch(request('launch',{action:'confirm',planId:result.planId,hash:txHash}),context);assert.equal(unmined.status,202);assert.equal((await unmined.json()).status,'pending');pending=false;
  head='0x101';const waiting=await launch(request('launch',{action:'confirm',planId:result.planId,hash:txHash}),context);assert.equal(waiting.status,202);assert.equal((await waiting.json()).status,'pending');head='0x103';assert.equal(bindings,0);
  receiptStatus='0x0';const reverted=await launch(request('launch',{action:'confirm',planId:result.planId,hash:txHash}),context);assert.equal(reverted.status,409);receiptStatus='0x1';
  const mismatch=await launch(request('launch',{action:'confirm',planId:result.planId,hash:txHash}),context);assert.equal(mismatch.status,400);assert.equal(bindings,0);
  confirmValue=result.transaction.value;const confirmed=await launch(request('launch',{action:'confirm',planId:result.planId,hash:txHash}),context);assert.equal(confirmed.status,200,await confirmed.clone().text());const launched=(await confirmed.json()).coin;assert.equal(launched.tokenAddress,address);assert.equal(launched.tweetUrl,tweet);assert.equal(publicCoin(launched).tweetUrl,tweet);assert.equal(bindings,1);
 }finally{globalThis.fetch=originalFetch;delete globalThis.__xTestCookies;sql.close()}
});

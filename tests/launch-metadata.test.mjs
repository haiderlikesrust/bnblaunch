import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CID} from 'multiformats/cid';
import {sha256} from 'multiformats/hashes/sha2';
import {privateKeyToAccount} from 'viem/accounts';
import {encodeAbiParameters} from 'viem';
import {metadataCid} from '../lib/metadata-cid.ts';
register('./x-oauth-loader.mjs',import.meta.url);
const env=globalThis.__shenTestEnv={APP_ORIGIN:'https://shen.now',SHEN_RUNTIME:'node',SIGNER_URL:'http://signer:8080',SIGNER_WEB_TOKEN:'a'.repeat(48),BNB_RPC_URL:'https://rpc.invalid'};
const {POST:metadata}=await import('../app/api/coins/[id]/metadata/route.ts');
const {POST:launch}=await import('../app/api/coins/[id]/launch/route.ts');
const {blankCoin}=await import('../lib/model.ts');
const {findSalt}=await import('../lib/flap.ts');
const hash=await sha256.digest(new TextEncoder().encode('{"description":"metadata regression"}'));
const rawCid=CID.createV1(0x55,hash).toString(),dagCid=CID.createV1(0x70,hash).toString(),v0=CID.createV0(hash).toString();
test('metadata accepts CIDv0 and CIDv1 codecs, rejecting malformed identifiers and URLs',()=>{
 for(const cid of [rawCid,dagCid,v0])assert.equal(metadataCid.parse(cid),cid);
 assert.match(rawCid,/^bafk/);
 for(const cid of ['',null,{},'bafy'+'a'.repeat(40),rawCid.slice(0,-3),rawCid+'/metadata.json','https://example.com/'+rawCid,'ipfs://'+rawCid,' '+rawCid,'b'.repeat(257)])assert.equal(metadataCid.safeParse(cid).success,false);
});
test('saved image upload and launch preparation accept a raw CID without broadcasting a transaction',async()=>{
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
 const {salt,address}=await findSalt(),originalFetch=globalThis.fetch;
 let uploadResult=rawCid,uploads=0;
 globalThis.fetch=async(input,init)=>{
  const url=String(input instanceof Request?input.url:input);
  if(url==='http://signer:8080/v1/status')return Response.json({chainId:56,signingReady:true});
  if(url===`http://signer:8080/v1/wallets/${id}/provision`)return Response.json({coinId:id,address:wallet,chainId:56});
  if(url==='https://funcs.flap.sh/api/upload'){
   uploads++;const form=init.body,operations=JSON.parse(form.get('operations'));
   assert.equal(operations.variables.meta.website,'https://shen.now/token/'+id);
   assert.equal(form.get('0').type,'image/png');
   return Response.json({data:{create:uploadResult}});
  }
  if(url==='https://rpc.invalid/'){
   const body=JSON.parse(input instanceof Request?await input.text():init.body);
   const results={eth_chainId:'0x38',eth_getCode:'0x',eth_call:encodeAbiParameters([{type:'address'}],[address]),eth_estimateGas:'0x100000'};
   assert.ok(Object.hasOwn(results,body.method),'Unexpected RPC method: '+body.method);
   return Response.json({jsonrpc:'2.0',id:body.id,result:results[body.method]});
  }
  throw Error('Unexpected external request: '+url);
 };
 const context={params:Promise.resolve({id})};
 const request=(path,data)=>new Request('https://shen.now/api/coins/'+id+'/'+path,{method:'POST',headers:{Origin:'https://shen.now','Content-Type':'application/json'},body:JSON.stringify(data)});
 try{
  const authorization=await launch(request('launch',{action:'authorize',creator:creator.address}),context);
  assert.equal(authorization.status,200,await authorization.clone().text());
  const auth=await authorization.json(),signature=await creator.signMessage({message:auth.message});
  const uploaded=await metadata(request('metadata',{useSavedImage:true}),context);
  assert.equal(uploaded.status,200);const {cid}=await uploaded.json();assert.equal(cid,rawCid);
  const prepared=await launch(request('launch',{action:'prepare',authorizationId:auth.authorizationId,signature,cid,salt}),context);
  assert.equal(prepared.status,200,await prepared.clone().text());
  assert.equal((await prepared.json()).predictedAddress,address);
  assert.equal(uploads,1);
  uploadResult='not-a-cid';const invalid=await metadata(request('metadata',{useSavedImage:true}),context);
  assert.equal(invalid.status,502);assert.match((await invalid.json()).error,/invalid metadata identifier/);
 }finally{globalThis.fetch=originalFetch;delete globalThis.__xTestCookies;sql.close()}
});

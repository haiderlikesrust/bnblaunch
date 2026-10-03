import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WalletStore, authenticate, loadMasterKey } from './store.mjs';
import { SigningEngine } from './engine.mjs';
const coin=randomUUID(),coin2=randomUUID(),token='0x1111111111111111111111111111111111117777',recipient='0x2222222222222222222222222222222222222222',launchHash='0x'+'a'.repeat(64);
const key=()=>randomBytes(32).toString('hex');
function fixture(path=':memory:',master=key()) {const store=new WalletStore(path,master);store.provision(coin);store.bindLaunch(coin,token,launchHash);const id=randomUUID();store.createIntent({id,coinId:coin,kind:'compute',amountWei:'100',expiresAt:Date.now()+60000});return {store,id};}
const expected={to:recipient,value:100n,data:'0x',nonce:0,gas:21000n,gasPrice:1000000000n};
const sign=(store,overrides={})=>store.account(coin).signTransaction({...expected,chainId:56,type:'legacy',...overrides});

test('agent can spend above the former daily fraction while confirmed funds and gas remain enforced',async()=>{
 for(const balance of [110n,100n]){
  const {store,id}=fixture();try{
   const client={getChainId:async()=>56,getBlock:async()=>({number:100n,timestamp:BigInt(Math.floor(Date.now()/1000))}),getTransactionCount:async()=>0,getBalance:async()=>balance,getGasPrice:async()=>1n,estimateGas:async()=>1n,getTransactionReceipt:async()=>{const error=Error();error.name='TransactionReceiptNotFoundError';throw error},sendRawTransaction:async()=>{throw Error('No network in this test')}};
   const engine=new SigningEngine(store,client,{settlementAddress:recipient,gasReserveWei:1n,maxGasPriceWei:2n});engine.bindLaunch=async()=>{};
   const execute=()=>engine.execute({id,coinId:coin,kind:'compute',amountWei:'100',expiresAt:Date.now()+60000});
   if(balance===110n){await execute();assert.ok(store.signedBytes(id))}else{await assert.rejects(execute(),/Insufficient confirmed funds/);assert.equal(store.signedBytes(id),null)}
  }finally{store.close()}
 }
});

test('coin wallets are isolated, idempotent, and encrypted with coin-bound AAD',()=>{
  const store=new WalletStore(':memory:',key());try{
    const a=store.provision(coin);assert.deepEqual(store.provision(coin),a);assert.notEqual(store.provision(coin2).address,a.address);
    const row=store.wallet(coin),aad=`wallet:v1:56:${coin}:${row.address}`,secret=store.open(row.sealed_key,aad);
    assert.match(secret,/^0x[0-9a-f]{64}$/);assert.ok(!row.sealed_key.includes(secret));assert.equal(store.account(coin).address,a.address);
    assert.throws(()=>store.open(row.sealed_key,`wallet:v1:56:${coin2}:${row.address}`));
    const box=JSON.parse(row.sealed_key);box.tag=Buffer.alloc(16).toString('base64');assert.throws(()=>store.open(JSON.stringify(box),aad));
  }finally{store.close()}
});
test('wallet recovery survives reopening; wrong master key fails',()=>{
  const dir=mkdtempSync(join(tmpdir(),'shen-wallet-test-')),path=join(dir,'wallet.sqlite'),master=key();
  try{const first=new WalletStore(path,master),wallet=first.provision(coin),row=first.wallet(coin),secret=first.open(row.sealed_key,`wallet:v1:56:${coin}:${row.address}`);first.close();
    assert.ok(!readFileSync(path).includes(Buffer.from(secret)));const recovered=new WalletStore(path,master);assert.equal(recovered.account(coin).address,wallet.address);recovered.close();assert.throws(()=>new WalletStore(path,key()));
  }finally{rmSync(dir,{recursive:true,force:true})}
});
test('unlaunched wallets and immutable launch rebinding are rejected',()=>{
  const store=new WalletStore(':memory:',key());try{store.provision(coin);assert.throws(()=>store.createIntent({id:randomUUID(),coinId:coin,kind:'compute',amountWei:'1',expiresAt:Date.now()+60000}));store.bindLaunch(coin,token,launchHash);assert.throws(()=>store.bindLaunch(coin,recipient,launchHash));}finally{store.close()}
});
test('intent idempotency binds coin, amount and operation even after expiry',()=>{
  const {store,id}=fixture();try{const request={id,coinId:coin,kind:'compute',amountWei:'100',expiresAt:0};assert.equal(store.createIntent(request).id,id);assert.throws(()=>store.createIntent({...request,amountWei:'101'}));assert.throws(()=>store.createIntent({...request,kind:'buyback'}));assert.throws(()=>store.createIntent({...request,id:randomUUID()}));}finally{store.close()}
});
test('invalid chain, recipient, amount or sender never enters the signing journal',async()=>{
  const {store,id}=fixture();try{const fence=store.acquire(coin);for(const overrides of [{chainId:1},{to:token},{value:101n},{nonce:1},{data:'0x1234'}])await assert.rejects(store.persistSigned(id,fence,await sign(store,overrides),expected));assert.equal(store.signedBytes(id),null);}finally{store.close()}
});
test('signing requires a live fence, unused intent and unexpired deadline',async()=>{
  const {store,id}=fixture();try{const fence=store.acquire(coin),raw=await sign(store);assert.throws(()=>store.acquire(coin));await assert.rejects(store.persistSigned(id,'wrong',raw,expected));store.db.prepare('UPDATE intents SET expires_at=0 WHERE id=?').run(id);await assert.rejects(store.persistSigned(id,fence,raw,expected));assert.equal(store.signedBytes(id),null);}finally{store.close()}
});
test('two database connections cannot commit competing signatures or nonces',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'shen-race-test-')),path=join(dir,'wallet.sqlite'),master=key();let a,b;
  try{({store:a}=fixture(path,master));b=new WalletStore(path,master);const intent=a.db.prepare('SELECT id FROM intents').get().id;const fence=a.acquire(coin);assert.throws(()=>b.acquire(coin));const raw=await sign(a);await a.persistSigned(intent,fence,raw,expected);await assert.rejects(b.persistSigned(intent,fence,raw,expected));assert.equal(b.signedBytes(intent),raw);
    const second=randomUUID();a.createIntent({id:second,coinId:coin,kind:'compute',amountWei:'100',expiresAt:Date.now()+60000});await assert.rejects(a.persistSigned(second,fence,raw,expected));
  }finally{a?.close();b?.close();rmSync(dir,{recursive:true,force:true})}
});
test('lost broadcast acknowledgement recovers exactly the same signed transaction',async()=>{
  const {store,id}=fixture();try{
    const raw=await sign(store),fence=store.acquire(coin);await store.persistSigned(id,fence,raw,expected);store.release(coin,fence);store.db.prepare('UPDATE intents SET expires_at=0 WHERE id=?').run(id);
    const sent=[];const client={getChainId:async()=>56,getBlock:async()=>({number:100n,timestamp:BigInt(Math.floor(Date.now()/1000))}),getTransactionReceipt:async()=>{const e=Error();e.name='TransactionReceiptNotFoundError';throw e},sendRawTransaction:async({serializedTransaction})=>{sent.push(serializedTransaction);throw Error('Connection lost after acceptance')}};
    const engine=new SigningEngine(store,client,{});await engine.reconcile(id);await engine.execute({id,coinId:coin,kind:'compute',amountWei:'100',expiresAt:0});assert.deepEqual(sent,[raw,raw]);assert.equal(store.intent(id).nonce,0);assert.equal(store.intent(id).status,'signed');
  }finally{store.close()}
});
test('only canonical sufficiently confirmed receipts complete an intent',async()=>{
  const {store,id}=fixture();try{const raw=await sign(store);await store.persistSigned(id,store.acquire(coin),raw,expected);
    const hash='0x'+'b'.repeat(64);let head=101n,canonical=hash;
    const client={getChainId:async()=>56,getBlock:async(args)=>args?{hash:canonical}:{number:head,timestamp:BigInt(Math.floor(Date.now()/1000))},getTransactionReceipt:async()=>({status:'success',blockNumber:100n,blockHash:hash})};
    const engine=new SigningEngine(store,client,{});await engine.reconcile(id);assert.equal(store.intent(id).status,'signed');head=103n;canonical='0x'+'c'.repeat(64);await assert.rejects(engine.reconcile(id));canonical=hash;await engine.reconcile(id);assert.equal(store.intent(id).status,'confirmed');canonical='0x'+'c'.repeat(64);await assert.rejects(engine.reconcile(id));
  }finally{store.close()}
});
test('only fixed settlement recipient and own-token sink transactions are constructed',async()=>{
  const {store}=fixture();try{const wallet=store.wallet(coin),engine=new SigningEngine(store,{readContract:async()=>500n},{settlementAddress:recipient});assert.deepEqual(await engine.requestTransaction({kind:'compute',amount_wei:'100'},wallet),{to:recipient,value:100n,data:'0x'});const burn=await engine.requestTransaction({kind:'burn',amount_wei:'100'},wallet);assert.equal(burn.to,token);assert.equal(burn.value,0n);await assert.rejects(engine.requestTransaction({kind:'burn',amount_wei:'501'},wallet));await assert.rejects(engine.requestTransaction({kind:'buyback',amount_wei:'1'},wallet));}finally{store.close()}
});
test('authentication and master-key validation fail closed',()=>{assert.throws(()=>loadMasterKey('weak'));assert.equal(authenticate('Bearer weak','weak'),false);const secret=key();assert.equal(authenticate('Bearer '+secret,secret),true);assert.equal(authenticate('Bearer '+secret+'x',secret),false)});

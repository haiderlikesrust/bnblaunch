import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {verifyLaunchWallet} from '../lib/launch-wallet.ts';
register('./runtime-loader.mjs',import.meta.url);
const env=globalThis.__shenTestEnv={};
const {ownedCoin}=await import('../lib/server.ts');
const owner='0x'+'a'.repeat(40),other='0x'+'b'.repeat(40);
test('launch checks the signed-in account before requesting a signature',async()=>{
 const transport=async(url,init)=>{
  assert.equal(url,'/api/auth');assert.equal(init.cache,'no-store');
  return Response.json({user:{userId:owner}});
 };
 await verifyLaunchWallet('0x'+'A'.repeat(40),transport);
 await assert.rejects(verifyLaunchWallet(other,transport),/selected wallet differs/);
 await assert.rejects(verifyLaunchWallet(owner,async()=>Response.json({user:null})),/Sign in with the wallet that created/);
 await assert.rejects(verifyLaunchWallet(owner,async()=>new Response(null,{status:503})),/Could not verify/);
});
test('a changed session cannot access the original wallet draft or discover another owner',async()=>{
 const row={id:'draft',owner,config:JSON.stringify({id:'draft'})};
 env.DB={prepare(sql){assert.match(sql,/WHERE id = \? AND owner = \?/);return {bind(id,wallet){return {async first(){return id===row.id&&wallet===owner?row:null}}}}}};
 assert.equal((await ownedCoin('draft',owner)).coin.id,'draft');
 const denied=async(id,wallet)=>{try{await ownedCoin(id,wallet);assert.fail('Private draft exposed')}catch(e){assert.equal(e.status,404);assert.match(e.message,/Sign in with the wallet that created/);return e.message}};
 assert.equal(await denied('draft',other),await denied('missing',other));
});

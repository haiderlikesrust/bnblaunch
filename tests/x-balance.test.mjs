import test from 'node:test';
import assert from 'node:assert/strict';
import {xProvider,XHttpFailure} from '../lib/x-official.ts';

test('concurrent agents share one balance request and refresh after a minute',async()=>{
 const original=Date.now;let now=1800000000000,calls=0;Date.now=()=>now;
 try{
  const transport=async()=>{calls++;return Response.json({data:{total_balance:2}})};
  assert.deepEqual(await Promise.all(Array.from({length:20},()=>xProvider('billing',transport).balance())),Array(20).fill(2000000));
  assert.equal(calls,1);now+=59000;assert.equal(await xProvider('billing',transport).balance(),2000000);assert.equal(calls,1);
  now+=1001;await xProvider('billing',transport).balance();assert.equal(calls,2);
  await xProvider('different-app',transport).balance();assert.equal(calls,3,'different credentials never share a balance');
 }finally{Date.now=original}
});

test('429 waits for the later of Retry-After and X reset without serving stale credit',async()=>{
 const original=Date.now;let now=1800000000000,calls=0;Date.now=()=>now;
 try{
  const transport=async()=>{calls++;return calls===1?Response.json({data:{total_balance:5}}):calls===2?Response.json({detail:'private-token-value'},{status:429,headers:{'retry-after':'30','x-rate-limit-reset':String((now+90000)/1000)}}):Response.json({data:{total_balance:0}})};
  const provider=xProvider('billing',transport);await provider.balance();now+=60001;
  await assert.rejects(provider.balance(),e=>e instanceof XHttpFailure&&e.retryAt===now+90000&&!e.message.includes('private-token'));
  now+=60000;await assert.rejects(xProvider('billing',transport).balance(),e=>e.status===429);assert.equal(calls,2);
  now+=30001;assert.equal(await provider.balance(),0);assert.equal(calls,3);
 }finally{Date.now=original}
});

test('malformed and unreachable balance stays unavailable, then retries after short backoff',async()=>{
 const original=Date.now;let now=1800000000000,calls=0;Date.now=()=>now;
 try{
  const provider=xProvider('billing',async()=>{calls++;if(calls===1)throw Error('network');return Response.json({data:{total_balance:'unknown'}})});
  await assert.rejects(provider.balance());await assert.rejects(provider.balance());assert.equal(calls,1);
  now+=10001;await assert.rejects(provider.balance());assert.equal(calls,2);
 }finally{Date.now=original}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {createHostRequestHandler,installHostRouting,domainHostLookupSql} from '../server/custom-host-router.mjs';

const domain='jade-agent.xyz',coinId='coin-1',challenge='test-verification-challenge-123456';
const mapping={domain,coin_id:coinId,state:'live',verification_token:challenge,expires_at:Date.now()+86400000};
async function fixture(t,lookup=async host=>host===domain?mapping:null){
 const calls=[];
 const listener=(req,res)=>{calls.push({url:req.url,headers:{...req.headers},method:req.method});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(calls.at(-1)));};
 const server=createServer(listener);await installHostRouting(server,{appOrigin:'https://shen.now',lookupDomain:lookup});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const call=(path,host=domain,extra={})=>new Promise((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port:server.address().port,path,method:extra.method??'GET',headers:{Host:host,...extra.headers}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});req.once('error',reject);req.end();
 });
 return {calls,call};
}

test('native HTTP custom-host boundary rewrites only the mapped site and removes credentials',async t=>{
 const {call,calls}=await fixture(t);
 const root=await call('/?ignored=1',domain,{headers:{Cookie:'wallet-session=secret',Authorization:'Bearer secret','X-Forwarded-Host':'shen.now','OAI-Authenticated-User-Id':'other','Next-Action':'malicious'}});
 assert.equal(root.status,200);assert.equal(root.headers['x-shen-site'],coinId);
 assert.equal(calls[0].url,'/sites/'+coinId);assert.equal(calls[0].headers.host,domain);
 for(const header of ['cookie','authorization','x-forwarded-host','oai-authenticated-user-id','next-action'])assert.equal(calls[0].headers[header],undefined);
 for(const path of ['/api/auth','/signin','/launch','/api/internal/worker','/sites/coin-2','/api/coins/coin-2/image','/assets/%2e%2e/api/auth'])assert.equal((await call(path)).status,404,path);
 assert.equal((await call('/',domain,{method:'POST'})).status,404);
 assert.equal(calls.length,1);
});

test('verification answers for the mapped published site without invoking the app',async t=>{
 const {call,calls}=await fixture(t,async host=>host===domain?{...mapping,state:'provisioning'}:null);
 const proof=await call('/.well-known/shen-site');assert.equal(proof.status,200);
 assert.deepEqual(JSON.parse(proof.body),{service:'shen-site',domain,coinId,challenge});assert.equal(calls.length,0);
 assert.equal(proof.headers['cache-control'],'no-store');
 const head=await call('/.well-known/shen-site',domain,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.body,'');
});

test('unknown, expired and deleted domain mappings fail closed',async t=>{
 const {call,calls}=await fixture(t,async host=>host==='expired.xyz'?{...mapping,domain:host,expires_at:Date.now()-1}:host==='removed.xyz'?{...mapping,domain:host,state:'removed'}:null);
 for(const host of ['unknown.xyz','expired.xyz','removed.xyz','jade-agent.xyz,shen.now'])assert.equal((await call('/',host)).status===200,false,host);
 assert.equal((await call('/docs','unknown.xyz',{headers:{'X-Forwarded-Host':'shen.now'}})).status,404);
 assert.equal(calls.length,0);
});

test('database failure cannot turn a custom hostname into the launchpad',async t=>{
 const {call,calls}=await fixture(t,async()=>{throw Error('Private database details');});
 const response=await call('/');assert.equal(response.status,503);assert.equal(response.body,'Website temporarily unavailable');assert.equal(calls.length,0);
});

test('canonical app requests keep authentication while internal hosts expose only expected paths',async t=>{
 let lookups=0;const {call,calls}=await fixture(t,async()=>{lookups++;return null;});
 const response=await call('/api/auth','shen.now',{method:'POST',headers:{Cookie:'session=kept','X-Forwarded-Host':'attacker.xyz'}});assert.equal(response.status,200);
 assert.equal(calls[0].headers.cookie,'session=kept');assert.equal(calls[0].headers['x-forwarded-host'],undefined);
 for(const host of ['localhost','127.0.0.1','web'])assert.equal((await call('/api/health',host)).status,200);
 assert.equal((await call('/api/internal/worker','web',{method:'POST'})).status,200);
 for(const host of ['localhost','127.0.0.1','web'])assert.equal((await call('/launch',host)).status,404);
 assert.equal((await call('/api/internal/worker','127.0.0.1')).status,404);assert.equal(lookups,0);
});

test('the production domain lookup cannot publish a draft or an unpublished coin',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');const db=new PGlite();
 try{
  await db.exec(`CREATE TABLE coins(id text PRIMARY KEY,token_address text); CREATE TABLE site_revisions(coin_id text); CREATE TABLE coin_domains(coin_id text,domain text,state text,verification_token text,expires_at bigint);
   INSERT INTO coins VALUES ('live','0x1'),('draft',NULL),('unpublished','0x2'); INSERT INTO site_revisions VALUES ('live'),('draft');
   INSERT INTO coin_domains VALUES ('live','live.xyz','live','challenge',NULL),('draft','draft.xyz','live','challenge',NULL),('unpublished','unpublished.xyz','live','challenge',NULL);`);
  assert.equal((await db.query(domainHostLookupSql,['live.xyz'])).rows[0].coin_id,'live');
  for(const host of ['draft.xyz','unpublished.xyz','unknown.xyz',"live.xyz' OR 1=1--"])assert.equal((await db.query(domainHostLookupSql,[host])).rows.length,0);
 }finally{await db.close();}
 assert.throws(()=>createHostRequestHandler({appOrigin:'https://shen.now/not-an-origin',lookupDomain:()=>null},()=>{}));
});

import assert from 'node:assert/strict';
import {request} from 'node:http';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
assert.equal(process.env.SMOKE_TEST_FIXTURE,'true','Run only against the disposable CI database');
const base='http://127.0.0.1:8088',origin=process.env.APP_ORIGIN;
// Node fetch replaces a supplied Host with the URL authority. Use native HTTP
// to exercise the real public hostname while connecting to the isolated gateway.
const platformFetch=(url,init={})=>new Promise((resolve,reject)=>{
 const req=request(url,{method:init.method??'GET',headers:{...init.headers,Host:new URL(origin).host}},res=>{
  const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.once('error',reject);res.once('end',()=>{
   const headers=new Headers();for(let i=0;i<res.rawHeaders.length;i+=2)headers.append(res.rawHeaders[i],res.rawHeaders[i+1]);
   resolve(new Response([204,205,304].includes(res.statusCode)?null:Buffer.concat(chunks),{status:res.statusCode,headers}));
  });
 });req.once('error',reject);req.setTimeout(30000,()=>req.destroy(Error('Smoke request timed out')));req.end(init.body);
});
const health=await (await platformFetch(base+'/api/health')).json();assert.equal(health.ok,true);assert.equal(health.database,'postgres');
for(const path of ['/','/launch','/agents','/activity','/signin','/docs','/shen-symbol.png','/models/glm.svg','/models/kimi.png'])assert.equal((await platformFetch(base+path)).status,200,path);
assert.equal((await platformFetch(base+'/api/internal/worker')).status,404,'Worker API is private at gateway');
const account=privateKeyToAccount(generatePrivateKey());
const post=async(path,data,cookie)=>platformFetch(base+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});
const auth=await (await post('/api/auth',{action:'challenge',wallet:account.address})).json();
assert.match(auth.message,new RegExp(origin.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
const signature=await account.signMessage({message:auth.message});
const login=await post('/api/auth',{action:'verify',id:auth.id,signature});assert.equal(login.status,200);
const setCookie=login.headers.get('set-cookie');assert.match(setCookie,/HttpOnly/i);assert.match(setCookie,/Secure/i);assert.match(setCookie,/SameSite=Lax/i);
const cookie=setCookie.split(';')[0];assert.equal((await post('/api/auth',{action:'verify',id:auth.id,signature})).status,401);
const input={name:'CI integration',symbol:'CITEST',description:'An isolated integration record for the production stack.',purpose:'Explain verified community updates and document the project’s progress transparently.',language:'en',research:false,social:false,images:false,website:true};
const created=await post('/api/coins',input,cookie);assert.equal(created.status,201);const {coin}=await created.json();
assert.equal((await platformFetch(base+'/api/coins/'+coin.id)).status,404);assert.equal((await platformFetch(base+'/api/coins/'+coin.id,{headers:{Cookie:cookie}})).status,200);
const readiness=await (await platformFetch(base+`/api/coins/${coin.id}/launch`,{headers:{Cookie:cookie}})).json();assert.equal(readiness.readiness.ready,false);
assert.equal((await post(`/api/coins/${coin.id}/launch`,{action:'authorize',creator:account.address,treasury:account.address},cookie)).status,400);
assert.equal((await post('/api/auth',{action:'logout'},cookie)).status,200);
assert.equal((await platformFetch(base+'/api/coins',{headers:{Cookie:cookie}})).status,401);
console.log('PASS: Node pages/assets, PostgreSQL, private worker API, signed wallet sessions, replay rejection, launch persistence and fail-closed readiness. No paid provider or chain calls.');

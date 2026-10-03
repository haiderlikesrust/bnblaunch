import test from 'node:test';
import assert from 'node:assert/strict';
import {createDomainHosting,HostingError,validateHostingConfig,pinnedHttpsRequest} from '../lib/domain-hosting.ts';
import {normalizeCustomDomain,publicIpv4,requestHostname,customHostRoute} from '../shared/domain-host.mjs';

const config={dokployUrl:'https://deploy.shen.now',apiKey:'test-only-key',composeId:'shen-compose',ipv4:'8.8.4.4'};
const domain='jade-agent.xyz',coinId='coin-1',challenge='test-verification-challenge-123456';
const route={domainId:'domain-1',host:domain,composeId:config.composeId,serviceName:'gateway',domainType:'compose',port:80,path:'/',internalPath:'/',stripPath:false,https:true,certificateType:'letsencrypt',enabled:true};
const json=data=>Response.json(data);

test('domain and Host parsing reject authority confusion, IDNs and non-approved names',()=>{
 assert.equal(normalizeCustomDomain('JADE-AGENT.XYZ'),domain);
 for(const value of ['https://jade.xyz',' jade.xyz','jade.xyz.','jade.xyz:443','a.b.xyz','xn--p1ai.xyz','神.xyz','jade.xyz/a','jade.xyz@127.0.0.1','a\n.xyz','jade.io','-jade.com','jade-.com'])assert.throws(()=>normalizeCustomDomain(value),value);
 assert.equal(requestHostname('JADE-AGENT.XYZ:443'),domain);
 for(const value of ['jade.xyz,evil.com','jade.xyz@evil.com','jade.xyz.','jade.xyz:65536','jade.xyz/path','jade.xyz\\evil','jade..xyz',' jade.xyz'])assert.equal(requestHostname(value),null,value);
});

test('custom host paths expose one site and its images without API or auth access',()=>{
 for(const path of ['/','/sites/coin-1'])assert.equal(customHostRoute(path,coinId),'site');
 assert.equal(customHostRoute('/.well-known/shen-site',coinId),'verification');
 for(const path of ['/assets/app-a.js','/_next/static/chunks/app.js','/fonts/space.woff2','/api/coins/coin-1/image','/api/coins/coin-1/publications/job-123/image'])assert.equal(customHostRoute(path,coinId),'asset');
 for(const path of ['/signin','/api/auth/session','/api/internal/worker','/api/coins/coin-2/image','/sites/coin-2','/api/coins/coin-1','/assets/../api/auth','/assets/%2e%2e/api/auth','//api/auth','/assets/app.js?x=1'])assert.equal(customHostRoute(path,coinId),'blocked',path);
});

test('hosting configuration requires HTTPS and a canonical global IPv4 address',async()=>{
 assert.equal(validateHostingConfig(config).dokployUrl,config.dokployUrl);
 for(const ip of ['127.0.0.1','10.1.2.3','172.16.0.1','169.254.169.254','100.64.0.1','192.0.2.1','192.168.1.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','0.0.0.0','008.8.4.4','8.8.4.999','2130706433','::1'])assert.equal(publicIpv4(ip),false,ip);
 for(const url of ['http://deploy.shen.now','https://key@deploy.shen.now','https://deploy.shen.now/api','https://deploy.shen.now?key=abc'])assert.throws(()=>validateHostingConfig({...config,dokployUrl:url}));
 await assert.rejects(pinnedHttpsRequest({domain,ipv4:'127.0.0.1',path:'/',maxBytes:4096}));
 await assert.rejects(pinnedHttpsRequest({domain,ipv4:config.ipv4,path:'/api/internal/worker',maxBytes:4096}));
});

test('provisioning recovers a timed out create by reading the existing exact route once',async()=>{
 let stored=false;const calls=[];
 const hosting=createDomainHosting(config,{fetch:async(url,init)=>{calls.push({url:String(url),...init});const method=new URL(url).pathname;
  if(method==='/api/domain.byComposeId')return json(stored?[route]:[]);
  if(method==='/api/domain.create'){stored=true;const body=JSON.parse(init.body);assert.equal(body.serviceName,'gateway');assert.equal(body.https,true);assert.equal(body.certificateType,'letsencrypt');assert.equal(body.port,80);throw Error('connection dropped after DB commit');}
  throw Error('Unexpected mutation');
 }});
 assert.deepEqual(await hosting.ensureRoute(domain,{allowCreate:true}),{domainId:'domain-1',created:false});
 assert.deepEqual(await hosting.ensureRoute(domain,{allowCreate:false}),{domainId:'domain-1',created:false});
 assert.equal(calls.filter(c=>c.method==='POST').length,1);
 assert.ok(calls.every(c=>c.redirect==='error'&&c.headers['x-api-key']==='test-only-key'));
});

test('uncertain creation is never silently repeated during reconciliation',async()=>{
 let creates=0;
 const hosting=createDomainHosting(config,{fetch:async(url)=>{if(new URL(url).pathname==='/api/domain.byComposeId')return json([]);creates++;throw Error('timeout');}});
 await assert.rejects(hosting.ensureRoute(domain,{allowCreate:true}),error=>error instanceof HostingError&&error.uncertain);
 assert.equal(await hosting.ensureRoute(domain,{allowCreate:false}),null);
 assert.equal(creates,1);
});

test('a failed preflight is distinguishable from every attempted mutation response',async()=>{
 const readFailure=createDomainHosting(config,{fetch:async()=>new Response('Unavailable',{status:503})});
 await assert.rejects(readFailure.ensureRoute(domain,{allowCreate:true}),error=>error instanceof HostingError&&!error.uncertain);
 let calls=0;const committed=createDomainHosting(config,{fetch:async url=>{
  if(new URL(url).pathname==='/api/domain.byComposeId')return json([]);
  calls++;return new Response('Audit failed after commit',{status:400});
 }});
 await assert.rejects(committed.ensureRoute(domain,{allowCreate:true}),error=>error instanceof HostingError&&error.uncertain);assert.equal(calls,1);
 const oddReply=createDomainHosting(config,{fetch:async url=>new URL(url).pathname==='/api/domain.byComposeId'?json([]):json({domainId:'created-with-unrecognized-fields'})});
 await assert.rejects(oddReply.ensureRoute(domain,{allowCreate:true}),error=>error instanceof HostingError&&error.uncertain);
});

test('existing conflicting routes and duplicate hosts are not modified',async()=>{
 for(const changed of [{port:3000},{serviceName:'signer'},{composeId:'other'},{https:false},{path:'/other'},{internalPath:'/admin'},{middlewares:['redirect-to-other']},{middlewares:{}},{enabled:false},{enabled:'true'},{forwardAuthEnabled:true},{stripPath:'false'}]){
  let mutations=0;const hosting=createDomainHosting(config,{fetch:async(_url,init)=>{if(init.method==='POST')mutations++;return json([{...route,...changed}]);}});
  await assert.rejects(hosting.ensureRoute(domain,{allowCreate:true}),error=>error.code==='route_conflict');assert.equal(mutations,0);
 }
 const hosting=createDomainHosting(config,{fetch:async()=>json([route,{...route,domainId:'duplicate'}])});
 await assert.rejects(hosting.findRoute(domain),error=>error.code==='route_conflict');
});

test('deployment applies the existing checkout once and a busy deployment stays untouched',async()=>{
 let busy=true;const writes=[];
 const hosting=createDomainHosting(config,{fetch:async(url,init)=>{
  const method=new URL(url).pathname;
  if(method==='/api/domain.byComposeId')return json([route]);
  if(method==='/api/compose.one')return json({composeId:config.composeId,composeType:'docker-compose',composeStatus:busy?'running':'done',env:'DO NOT EXPOSE THIS'});
  writes.push({method,body:JSON.parse(init.body)});return json({success:true,composeId:config.composeId});
 }});
 assert.deepEqual(await hosting.queueDeployment(domain,'operation-1'),{queued:false,reason:'busy'});assert.equal(writes.length,0);
 busy=false;assert.deepEqual(await hosting.queueDeployment(domain,'operation-1'),{queued:true});
 assert.equal(writes.length,1);assert.equal(writes[0].method,'/api/compose.redeploy');assert.equal(writes[0].body.freshVolumes,undefined);
 assert.deepEqual(await hosting.composeStatus(),{status:'done'});
});

test('an uncertain deployment response is reported without a retry or destructive fallback',async()=>{
 let writes=0;const hosting=createDomainHosting(config,{fetch:async(url)=>{
  if(new URL(url).pathname==='/api/domain.byComposeId')return json([route]);
  if(new URL(url).pathname==='/api/compose.one')return json({composeId:config.composeId,composeType:'docker-compose',composeStatus:'done'});
  writes++;return new Response('Unknown outcome',{status:502});
 }});
 await assert.rejects(hosting.queueDeployment(domain,'operation-1'),error=>error instanceof HostingError&&error.uncertain);assert.equal(writes,1);
});

function verification(overrides={}){
 const calls=[];
 const hosting=createDomainHosting(config,{resolve4:async()=>[config.ipv4],resolve6:async()=>[],requestHttps:async input=>{calls.push(input);return input.path==='/'?{status:200,contentType:'text/html; charset=utf-8',body:`<main data-shen-site="${coinId}">Published site</main>`}:{status:200,contentType:'application/json',body:JSON.stringify({service:'shen-site',domain,coinId,challenge})};},...overrides});
 return {hosting,calls};
}

test('live verification proves exclusive DNS, HTTPS identity and the published root page',async()=>{
 const {hosting,calls}=verification();assert.deepEqual(await hosting.verifySite(domain,coinId,challenge),{live:true,reason:null});
 assert.equal(calls.length,2);assert.ok(calls.every(call=>call.domain===domain&&call.ipv4===config.ipv4));
 assert.equal(calls[0].path,'/.well-known/shen-site');assert.equal(calls[1].path,'/');
});

test('verification rejects private/mixed DNS and AAAA before making any HTTP request',async()=>{
 for(const changes of [{resolve4:async()=>['127.0.0.1']},{resolve4:async()=>[config.ipv4,'8.8.8.8']},{resolve4:async()=>[]},{resolve6:async()=>['::1']},{resolve6:async()=>{throw Error('DNS unavailable');}}]){
  const {hosting,calls}=verification(changes);assert.equal((await hosting.verifySite(domain,coinId,challenge)).live,false);assert.equal(calls.length,0);
 }
});

test('a redirect, wrong coin, stale challenge, wrong root page or invalid certificate never marks live',async()=>{
 for(const response of [{status:302,contentType:'application/json',body:'{}'},{status:200,contentType:'text/html',body:'{}'},{status:200,contentType:'application/json',body:JSON.stringify({service:'shen-site',domain,coinId:'coin-2',challenge})},{status:200,contentType:'application/json',body:JSON.stringify({service:'shen-site',domain,coinId,challenge:'old'})}]){
  const {hosting}=verification({requestHttps:async()=>response});assert.equal((await hosting.verifySite(domain,coinId,challenge)).live,false);
 }
 const wrongPage=verification({requestHttps:async input=>input.path==='/'?{status:200,contentType:'text/html',body:'<main data-shen-site="coin-2">Other site</main>'}:{status:200,contentType:'application/json',body:JSON.stringify({service:'shen-site',domain,coinId,challenge})}});
 assert.equal((await wrongPage.hosting.verifySite(domain,coinId,challenge)).live,false);
 const badCertificate=verification({requestHttps:async()=>{throw Error('CERT_HAS_EXPIRED');}});assert.equal((await badCertificate.hosting.verifySite(domain,coinId,challenge)).live,false);
});

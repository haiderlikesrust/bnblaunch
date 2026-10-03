import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { xProvider, imageQuote, generateImage } from '../lib/content-providers.ts';
import { publicationInput, matchingTweet } from '../lib/content-policy.ts';
import { sealServiceSecret, openServiceSecret } from '../shared/service-secrets.mjs';
const json=v=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}});
const quoteResponse={endpoints:[{provider_tag:'seed',supported_parameters:{resolution:{values:['1K','2K']},aspect_ratio:{values:['1:1']}},pricing:[{billable:'output_image',unit:'image',cost_usd:.04},{billable:'input_image',unit:'image',cost_usd:0}]}]};
test('image generation pins a quoted provider and requires a valid image plus actual cost',async()=>{
 const quote=await imageQuote(undefined,async()=>json(quoteResponse));assert.equal(quote.cost,40000);assert.equal(quote.ceiling,50000);
 const png=readFileSync('public/shen-symbol.png').toString('base64');let request;
 const image=await generateImage('test-key',quote,'Original artwork',async(url,init)=>{request=JSON.parse(init.body);return json({data:[{b64_json:png,media_type:'image/png'}],usage:{cost:.04}})});
 assert.equal(image.cost,40000);assert.deepEqual(request.provider,{only:['seed'],allow_fallbacks:false});assert.equal(request.n,1);assert.equal(request.resolution,'1K');assert.equal(request.output_format,undefined);
 await assert.rejects(generateImage('test-key',quote,'Artwork',async()=>json({data:[{b64_json:png}]})),e=>e.uncertain&&e.cost===null);
 await assert.rejects(generateImage('test-key',quote,'Artwork',async()=>new Response('',{status:502})),e=>!e.uncertain&&e.cost===0);
 await assert.rejects(imageQuote(undefined,async()=>json({endpoints:[{...quoteResponse.endpoints[0],pricing:[{billable:'output_image',unit:'token',cost_usd:.04}]}]})));
});
test('X transport uses documented cookie fields and binary multipart upload without leaking provider errors',async()=>{
 const calls=[];const provider=xProvider('test-key',async(url,init)=>{calls.push({url,init});if(url.includes('user_login'))return json({status:'success',login_cookie:'private-session'});if(url.includes('upload'))return json({status:'success',media_id:'321'});if(url.includes('create_tweet'))return json({status:'success',tweet_id:'123'});return json({status:'success',data:{tweets:[]}})});
 const cookie=await provider.login({user_name:'shen',email:'example@example.com',password:'disposable',proxy:'http://example.test:80'});assert.equal(cookie,'private-session');
 await provider.upload({loginCookies:cookie,proxy:'http://example.test:80'},new File(['png'],'art.png',{type:'image/png'}));
 assert.equal(calls[1].init.body.get('login_cookies'),cookie);assert.equal(calls[1].init.headers['Content-Type'],undefined);assert.ok(calls[1].init.body.get('file') instanceof File);
 await provider.post({loginCookies:cookie,proxy:'http://example.test:80'},'An update','321');assert.deepEqual(JSON.parse(calls[2].init.body).media_ids,['321']);
 assert.deepEqual(await provider.tweets('1'),[]);
 await assert.rejects(xProvider('key',async()=>json({recharge_credits:null})).balance());
 await assert.rejects(xProvider('key',async()=>json({status:'success',data:{id:123,userName:'shen'}})).user('shen'));
 await assert.rejects(xProvider('key',async()=>json({status:'error',msg:'private-session'})).post({loginCookies:cookie,proxy:'x'},'post'),e=>!e.message.includes(cookie));
});
test('X text validation covers Chinese weights and reconciliation rejects wrong identity, duplicates and retweets',()=>{
 const base={destination:'x',text:'中'.repeat(140),imagePrompt:null,altText:''};assert.equal(publicationInput.safeParse(base).success,true);assert.equal(publicationInput.safeParse({...base,text:'中'.repeat(141)}).success,false);
 const now=Date.now(),expect={userId:'1',text:'Verified update',startedAt:now},tweet={id:'22',author:{id:'1'},text:expect.text,createdAt:new Date(now).toISOString()};
 assert.equal(matchingTweet([tweet],expect),'22');assert.equal(matchingTweet([tweet,tweet],expect),null);assert.equal(matchingTweet([{...tweet,author:{id:'2'}}],expect),null);assert.equal(matchingTweet([{...tweet,retweeted_tweet:{id:'3'}}],expect),null);
 assert.equal(matchingTweet([{...tweet,text:'Visit https://t.co/abc',entities:{urls:[{url:'https://t.co/abc',expanded_url:'https://shen.now/docs'}]}}],{...expect,text:'Visit https://shen.now/docs'}),'22');
 assert.equal(matchingTweet([tweet],{...expect,mediaId:'999'}),null);
 const photo={...tweet,text:'Verified update https://t.co/media',extendedEntities:{media:[{id_str:'999',url:'https://t.co/media'}]}};assert.equal(matchingTweet([photo],{...expect,mediaId:'999'}),'22');
});
test('encrypted X sessions are bound to coin, immutable account and version',async()=>{
 const key=randomBytes(32).toString('hex'),context='coin:123:version1',data={loginCookies:'private-cookie',proxy:'private-proxy'};
 const cipher=await sealServiceSecret(key,context,data);assert.ok(!cipher.includes(data.loginCookies));assert.deepEqual(await openServiceSecret(key,context,cipher),data);
 await assert.rejects(openServiceSecret(key,'different:123:version1',cipher));await assert.rejects(openServiceSecret(randomBytes(32).toString('hex'),context,cipher));
});

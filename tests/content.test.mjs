import { xProvider } from '../lib/x-official.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { imageQuote, generateImage } from '../lib/content-providers.ts';
import { publicationInput, matchingTweet } from '../lib/content-policy.ts';
import { sealServiceSecret, openServiceSecret } from '../shared/service-secrets.mjs';
const json=v=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}});
const quoteResponse={endpoints:[{provider_tag:'seed',supported_parameters:{resolution:{values:['1K','2K']},aspect_ratio:{values:['1:1']}},pricing:[{billable:'output_image',unit:'image',cost_usd:.04},{billable:'input_image',unit:'image',cost_usd:0}]}]};
test('image generation pins a quoted provider and requires a valid image plus actual cost',async()=>{
 const quote=await imageQuote(undefined,async()=>json(quoteResponse));assert.equal(quote.cost,40000);assert.equal(quote.ceiling,50000);
 const png=readFileSync('public/shen-symbol.png').toString('base64');let request;
 const image=await generateImage('test-key',quote,'Original artwork',async(url,init)=>{request=JSON.parse(init.body);return json({data:[{b64_json:png,media_type:'image/png'}],usage:{cost:.04}})});
 assert.equal(image.cost,40000);assert.deepEqual(request.provider,{only:['seed'],allow_fallbacks:false});assert.equal(request.n,1);assert.equal(request.resolution,'2K');assert.equal(request.output_format,undefined);
 await assert.rejects(generateImage('test-key',quote,'Artwork',async()=>json({data:[{b64_json:png}]})),e=>e.uncertain&&e.cost===null);
 await assert.rejects(generateImage('test-key',quote,'Artwork',async()=>new Response('',{status:502})),e=>!e.uncertain&&e.cost===0);
 await assert.rejects(generateImage('test-key',quote,'Artwork',async()=>new Response('private provider detail',{status:400})),e=>!e.uncertain&&e.cost===0&&e.httpStatus===400&&!e.message.includes('private'));
 await assert.rejects(generateImage('test-key',quote,'Artwork',async()=>{throw Error('timeout')}),e=>e.uncertain&&e.cost===null);
 await assert.rejects(generateImage('test-key',quote,'Artwork',async()=>new Response('',{status:500})),e=>e.uncertain&&e.cost===null);
 await assert.rejects(imageQuote(undefined,async()=>json({endpoints:[{...quoteResponse.endpoints[0],supported_parameters:{resolution:{values:['1K']},aspect_ratio:{values:['1:1']}}}]})),undefined,'4.5 cannot be quoted for a 1K-only endpoint');
 await assert.rejects(imageQuote(undefined,async()=>json({endpoints:[{...quoteResponse.endpoints[0],pricing:[{billable:'output_image',unit:'token',cost_usd:.04}]}]})));
});
test('official X transport uses bearer tokens, multipart media and exact post payloads',async()=>{
 const calls=[];const provider=xProvider('billing',async(url,init)=>{calls.push({url,init});if(url.endsWith('/media/upload'))return json({data:{id:'321'}});if(url.endsWith('/2/tweets'))return json({data:{id:'123'}});if(url.includes('/usage/credits'))return json({data:{total_balance:12.5}});return json({data:[]})});
 const session={accessToken:'private-access'};
 await provider.upload(session,new File(['png'],'art.png',{type:'image/png'}));
 assert.equal(calls[0].init.headers.Authorization,'Bearer private-access');assert.equal(calls[0].init.body.get('media_category'),'tweet_image');assert.ok(calls[0].init.body.get('media') instanceof File);
 await provider.post(session,'An update','321');assert.deepEqual(JSON.parse(calls[1].init.body),{text:'An update',media:{media_ids:['321']}});
 assert.deepEqual(await provider.tweets(session,'1'),[]);assert.equal(await provider.balance(),12500000);
 await assert.rejects(xProvider('key',async()=>json({data:{total_balance:null}})).balance());
 await assert.rejects(xProvider('key',async()=>new Response('private-access',{status:401})).post(session,'post'),e=>!e.message.includes(session.accessToken));
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
 const key=randomBytes(32).toString('hex'),context='coin:123:version1',data={accessToken:'private-access',refreshToken:'private-refresh'};
 const cipher=await sealServiceSecret(key,context,data);assert.ok(!cipher.includes(data.accessToken));assert.deepEqual(await openServiceSecret(key,context,cipher),data);
 await assert.rejects(openServiceSecret(key,'different:123:version1',cipher));await assert.rejects(openServiceSecret(randomBytes(32).toString('hex'),context,cipher));
});

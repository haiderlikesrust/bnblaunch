import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./runtime-loader.mjs',import.meta.url);
globalThis.__shenTestEnv={OPENROUTER_API_KEY:'test',DB:{prepare(){return {bind(){return this},async run(){return {meta:{changes:1}}}}}}};
const {AGENT_MODELS}=await import('../lib/agent-models.ts');
const {chatPrice,chatCompletion}=await import('../lib/chat-completion.ts');

test('planning uses only catalog-supported low reasoning and keeps ordinary chat unchanged',async()=>{
 const original=globalThis.fetch,bodies=[];
 const options=[
  {supported_parameters:['response_format','reasoning'],reasoning:{mandatory:true,supported_efforts:['max','high','low']}},
  {supported_parameters:['response_format','reasoning'],reasoning:{supported_efforts:null}},
  {supported_parameters:['response_format','reasoning'],reasoning:{supported_efforts:['high']}},
  {supported_parameters:['response_format']},
  {supported_parameters:['response_format','reasoning'],reasoning:{}},
 ];
 globalThis.fetch=async(url,init)=>{
  if(String(url).endsWith('/models'))return Response.json({data:AGENT_MODELS.map((m,i)=>({id:m.id,pricing:{prompt:'0.000001',completion:'0.000002'},...options[i]}))});
  bodies.push(JSON.parse(init.body));return Response.json({choices:[{finish_reason:'stop',message:{content:'{}'}}],usage:{cost:0.001}});
 };
 try{
  for(let i=0;i<AGENT_MODELS.length;i++){
   const price=await chatPrice(AGENT_MODELS[i].id);
   await chatCompletion(price,'Return JSON.',{},8192,32000,{coinId:'coin',runId:'run-'+i,kind:'planner'});
   assert.deepEqual(bodies.at(-1).reasoning,i<2?{effort:'low'}:undefined);
   assert.equal(bodies.at(-1).max_tokens,8192);assert.equal(bodies.at(-1).provider.require_parameters,true);
  }
  await chatCompletion(await chatPrice(AGENT_MODELS[0].id),'Return JSON.',{});
  assert.equal(bodies.at(-1).reasoning,undefined);assert.equal(bodies.at(-1).max_tokens,800);
 }finally{globalThis.fetch=original;}
});

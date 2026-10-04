import test from 'node:test';
import assert from 'node:assert/strict';
import {identityStepInput,agentStepInput,creatorInput} from '../lib/policy.ts';
import {DEFAULT_AGENT_MODEL} from '../lib/agent-models.ts';
const form={name:'Dawnald Twup',symbol:'DAWNALD',description:'A fictional parody character community.',language:'en',purpose:'',personality:'',focus:'',modelId:DEFAULT_AGENT_MODEL,social:true,research:true,website:true,images:true,influencer:null};
test('Identity Continue accepts the shared form while later steps are unfinished',()=>{
 assert.equal(identityStepInput.safeParse(form).success,true);
 for(const field of ['name','symbol','description'])assert.equal(identityStepInput.safeParse({...form,[field]:''}).success,false);
});
test('Agent Continue ignores the optional later-step field but validates its own mission',()=>{
 assert.equal(agentStepInput.safeParse(form).success,false);
 assert.equal(agentStepInput.safeParse({...form,purpose:'Explain community research with clear sources.'}).success,true);
});
test('final creation remains strict and validates fields skipped by early steps',()=>{
 const full={...form,purpose:'Explain community research with clear sources.'};
 assert.equal(creatorInput.safeParse(full).success,true);
 assert.equal(creatorInput.safeParse({...full,treasury:100}).success,false);
 assert.equal(creatorInput.safeParse({...full,influencer:{enabled:true,kind:"invalid-kind"}}).success,false);
});

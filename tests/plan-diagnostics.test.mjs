import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {planValidationDiagnostic,publicPlanDiagnostic,readPlanDiagnostic} from '../lib/plan-diagnostics.ts';

test('diagnostics never include unknown keys, received values or arbitrary error messages',()=>{
 const result=z.object({summary:z.string(),kind:z.enum(['none'])}).strict().safeParse({summary:null,kind:'private-value','private-key':'secret'});
 const diagnostic=planValidationDiagnostic(result.error);
 const visible=JSON.stringify(publicPlanDiagnostic(diagnostic));
 assert.equal(visible.includes('private'),false);assert.equal(visible.includes('secret'),false);
 assert.match(visible,/summary/);assert.match(visible,/unsupported fields/);
 assert.equal(JSON.stringify(planValidationDiagnostic(Error('private API error'))),'\{"code":"policy"\}');
 assert.equal(readPlanDiagnostic('private raw text'),null);
});

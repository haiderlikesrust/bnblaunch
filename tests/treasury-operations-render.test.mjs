import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {transformSync} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const source=readFileSync(new URL('../components/treasury-operations.tsx',import.meta.url),'utf8');
const {code}=transformSync(source,{loader:'tsx',jsx:'automatic',format:'cjs',target:'es2022'});
const module={exports:{}};
new Function('require','module','exports',code)(createRequire(import.meta.url),module,module.exports);
const {TreasuryOperationsView}=module.exports;
const hash='0x'+'a'.repeat(64);
const base={id:'payment',kind:'compute',amountWei:'10000000000000000',status:'confirmed',hash,createdAt:Date.now(),reason:'Prepay services.'};
const render=operations=>renderToStaticMarkup(createElement(TreasuryOperationsView,{operations,symbol:'TEST',t:(_zh,en)=>en}));

test('Revenue renders new service funding details without campaign transactions',()=>{
 const html=render([{...base,details:{stage:'credit_available',creditMicrousd:6000000,valuation:{amountWei:base.amountWei}}}]);
 assert.match(html,/Service credit/);assert.match(html,/\$6\.00/);assert.match(html,new RegExp('https://bscscan.com/tx/'+hash));
 assert.doesNotMatch(html,/Purchased|Sent to burn sink|Transaction receipts/);
});
test('Revenue renders legacy payments, pending allocation and missing campaign receipts',()=>{
 assert.doesNotThrow(()=>render([{...base,details:null},{...base,id:'pending',status:'awaiting_credit',details:{stage:'deposit_confirmed',creditMicrousd:6000000}},{...base,id:'campaign',kind:'buyback_burn',details:{stage:'buy'}}]));
 assert.match(render([{...base,status:'awaiting_credit',details:{creditMicrousd:6000000}}]),/Credit awaiting allocation/);
});
test('Revenue retains reward amounts and campaign receipt links',()=>{
 const html=render([{...base,kind:'rewards',details:{paidWei:'1000000000000000',confirmedCount:2,recipientCount:3,transactions:[{hash,kind:'rewards',status:'confirmed',recipient:null,amountWei:'1000000000000000'}]}}]);
 assert.match(html,/Paid/);assert.match(html,/0\.001/);assert.match(html,/2 \/ 3/);assert.match(html,/Transaction receipts/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./runtime-loader.mjs',import.meta.url);
globalThis.__shenTestEnv={};
const {readBody,body}=await import('../lib/server.ts');

test('upload limit rejects chunked bodies without trusting Content-Length',async()=>{
 for(const headers of [{},{'Content-Length':'1'}]){
  let canceled=false;
  const stream=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(9))},cancel(){canceled=true}});
  const request=new Request('https://shen.test/upload',{method:'POST',body:stream,duplex:'half',headers});
  await assert.rejects(readBody(request,16),error=>error.status===413);
  assert.equal(canceled,true);
  assert.equal(request.body.locked,false);
 }
});

test('bounded multipart body still parses an ordinary token image',async()=>{
 const form=new FormData();form.append('image',new File([new Uint8Array([137,80,78,71])],'token.png',{type:'image/png'}));
 const request=new Request('https://shen.test/upload',{method:'POST',body:form});
 const bytes=await readBody(request,2200000);
 const parsed=await new Response(bytes,{headers:{'Content-Type':request.headers.get('content-type')}}).formData();
 assert.equal(parsed.get('image').name,'token.png');
 assert.equal(parsed.get('image').size,4);
});

test('JSON body preserves Unicode across chunks and rejects invalid JSON',async()=>{
 const input={text:'神·SHEN'},encoded=new TextEncoder().encode(JSON.stringify(input));
 const stream=new ReadableStream({start(controller){for(const byte of encoded)controller.enqueue(Uint8Array.of(byte));controller.close()}});
 assert.deepEqual(await body(new Request('https://shen.test',{method:'POST',body:stream,duplex:'half'}),encoded.length),input);
 await assert.rejects(body(new Request('https://shen.test',{method:'POST',body:'{'})),error=>error.status===400);
 await assert.rejects(readBody(new Request('https://shen.test',{method:'POST',body:'x',headers:{'Content-Length':'200'}}),20),error=>error.status===413);
});

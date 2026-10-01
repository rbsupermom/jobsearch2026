import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createAirtableTestService,parseAirtableTest,verifyAirtableSecret} from '../airtable-test.mjs';
import {createHandler} from '../handler.mjs';

const payload={recordId:'recTEST00000000001',jobId:'TEST-001',company:'Jamie Bridge Test',role:'Airtable Sync Validation'};

test('Airtable test payload is locked to TEST-001 and known fields',()=>{
  assert.deepEqual(parseAirtableTest(payload),payload);
  assert.throws(()=>parseAirtableTest({...payload,jobId:'REAL-001'}),/Only TEST-001/);
  assert.throws(()=>parseAirtableTest({...payload,status:'New'}),/Unknown Airtable test field/);
});

test('Airtable secret fails closed when missing or wrong',()=>{
  assert.throws(()=>verifyAirtableSecret(undefined,'correct-secret'),/authentication required/);
  assert.throws(()=>verifyAirtableSecret('wrong-secret','correct-secret'),/authentication failed/);
  assert.throws(()=>verifyAirtableSecret('anything',''),/not configured/);
  assert.doesNotThrow(()=>verifyAirtableSecret('correct-secret','correct-secret'));
});

test('Airtable test write stays outside the canonical board document',async()=>{
  let path,saved;
  const ref={set:async(fields,options)=>{saved={fields,options};}};
  const db={doc:p=>(path=p,ref)};
  const service=createAirtableTestService({db,ownerUid:'synthetic-owner',serverTimestamp:()=> 'server-time'});
  const result=await service.record(payload);
  assert.equal(path,'users/synthetic-owner/integrations/airtable');
  assert.deepEqual(saved.options,{merge:true});
  assert.deepEqual(saved.fields,{
    source:'airtable',jobId:'TEST-001',airtableRecordId:payload.recordId,
    company:payload.company,role:payload.role,receivedAt:'server-time'
  });
  assert.deepEqual(result,{ok:true,jobId:'TEST-001',recordId:payload.recordId});
});

async function listen(handler){
  const server=createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,url:`http://127.0.0.1:${server.address().port}`};
}

test('Airtable HTTP route requires the private secret and accepts only the isolated test payload',async t=>{
  const received=[];
  const handler=createHandler({
    service:{},authenticate:async()=>({canWrite:false}),publicUrl:'https://bridge.example',issuer:'https://issuer.example/',
    airtableSecret:'correct-secret',airtableTest:{record:async value=>(received.push(value),{ok:true,jobId:value.jobId,recordId:value.recordId})}
  });
  const {server,url}=await listen(handler);t.after(()=>server.close());
  const post=(secret,body=payload)=>fetch(url+'/airtable-test',{
    method:'POST',headers:{'Content-Type':'application/json',...(secret?{'X-Airtable-Sync-Secret':secret}:{})},body:JSON.stringify(body)
  });
  const missing=await post();assert.equal(missing.status,401);assert.equal(missing.headers.get('www-authenticate'),null);
  assert.equal((await post('wrong-secret')).status,401);
  const invalid=await post('correct-secret',{...payload,jobId:'REAL-001'});assert.equal(invalid.status,400);
  const ok=await post('correct-secret');assert.equal(ok.status,200);
  assert.deepEqual(await ok.json(),{ok:true,jobId:'TEST-001',recordId:payload.recordId});
  assert.deepEqual(received,[payload]);
});

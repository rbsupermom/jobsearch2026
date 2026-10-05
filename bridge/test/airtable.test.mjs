import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createAirtableReader,createAirtableTestService,parseAirtableTestRecord} from '../airtable-test.mjs';
import {createHandler} from '../handler.mjs';

const airtableRecord={id:'recTEST00000000001',fields:{'Job ID':'TEST-001',Company:'Jamie Bridge Test',Role:'Airtable Sync Validation'}};
const payload={recordId:'recTEST00000000001',jobId:'TEST-001',company:'Jamie Bridge Test',role:'Airtable Sync Validation'};

test('Airtable record parser is locked to TEST-001',()=>{
  assert.deepEqual(parseAirtableTestRecord(airtableRecord),payload);
  assert.throws(()=>parseAirtableTestRecord({...airtableRecord,fields:{...airtableRecord.fields,'Job ID':'REAL-001'}}),/other than TEST-001/);
  assert.throws(()=>parseAirtableTestRecord({id:'rec1',fields:{'Job ID':'TEST-001'}}),/Company/);
});

test('Airtable reader fetches only TEST-001 with server-side bearer auth',async()=>{
  let request;
  const fetchImpl=async(url,options)=>{
    request={url,options};
    return {ok:true,json:async()=>({records:[airtableRecord]})};
  };
  const reader=createAirtableReader({fetchImpl,pat:'pat-secret',baseId:'appBase',tableId:'tblJobs'});
  assert.deepEqual(await reader.fetchTest001(),payload);
  assert.match(request.url,/api\.airtable\.com\/v0\/appBase\/tblJobs/);
  assert.match(request.url,/maxRecords=2/);
  assert.match(decodeURIComponent(request.url),/\{Job ID\}='TEST-001'/);
  assert.equal(request.options.headers.Authorization,'Bearer pat-secret');
});

test('Airtable reader fails closed for missing config, failed HTTP, or ambiguous lookup',async()=>{
  await assert.rejects(()=>createAirtableReader({fetchImpl:async()=>({ok:true,json:async()=>({records:[airtableRecord]})})}).fetchTest001(),/AIRTABLE_PAT/);
  await assert.rejects(()=>createAirtableReader({fetchImpl:async()=>({ok:false}),pat:'p',baseId:'a',tableId:'t'}).fetchTest001(),/read failed/);
  await assert.rejects(()=>createAirtableReader({fetchImpl:async()=>({ok:true,json:async()=>({records:[]})}),pat:'p',baseId:'a',tableId:'t'}).fetchTest001(),/exactly one record/);
  await assert.rejects(()=>createAirtableReader({fetchImpl:async()=>({ok:true,json:async()=>({records:[airtableRecord,airtableRecord]})}),pat:'p',baseId:'a',tableId:'t'}).fetchTest001(),/exactly one record/);
});

test('Airtable test write stays outside the canonical board document',async()=>{
  let path,saved;
  const ref={set:async(fields,options)=>{saved={fields,options};}};
  const db={doc:p=>(path=p,ref)};
  const service=createAirtableTestService({db,ownerUid:'synthetic-owner',serverTimestamp:()=> 'server-time',airtable:{fetchTest001:async()=>payload}});
  const result=await service.pull();
  assert.equal(path,'users/synthetic-owner/integrations/airtable');
  assert.deepEqual(saved.options,{merge:true});
  assert.deepEqual(saved.fields,{
    source:'airtable',jobId:'TEST-001',airtableRecordId:payload.recordId,
    company:payload.company,role:payload.role,receivedAt:'server-time'
  });
  assert.deepEqual(result,{ok:true,jobId:'TEST-001'});
});

async function listen(handler){
  const server=createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,url:`http://127.0.0.1:${server.address().port}`};
}

test('isolated Airtable pull route is GET-only and does not expose record contents',async t=>{
  let pulls=0;
  const handler=createHandler({
    service:{},authenticate:async()=>({canWrite:false}),publicUrl:'https://bridge.example',issuer:'https://issuer.example/',
    airtableTest:{pull:async()=>{pulls++;return {ok:true,jobId:'TEST-001'};}}
  });
  const {server,url}=await listen(handler);t.after(()=>server.close());
  const post=await fetch(url+'/airtable-test-pull',{method:'POST'});assert.equal(post.status,405);
  const ok=await fetch(url+'/airtable-test-pull');assert.equal(ok.status,200);
  assert.deepEqual(await ok.json(),{ok:true,jobId:'TEST-001'});
  assert.equal(pulls,1);
  assert.equal(ok.headers.get('x-robots-tag'),'noindex, nofollow');
});

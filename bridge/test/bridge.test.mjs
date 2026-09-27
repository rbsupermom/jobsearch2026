import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {generateKeyPair,SignJWT,exportJWK} from 'jose';
import {planMerge,createBoardService,identity} from '../core.mjs';
import {authorizeClaims,createOAuth} from '../auth.mjs';
import {createHandler} from '../handler.mjs';
import {mergeBoards} from '../../sync-core.mjs';

const today=new Date().toISOString().slice(0,10);
const job={company:'Example Co',role:'Operations Coordinator',url:'https://example.org/jobs/123',
  status:'Reviewing',viewed:true,viewedAt:'9/22/2026',userNotes:'My exact note',priority:'High',fit:'Strong',note:'Original fit assessment',gap:'Original gap',lane:'Operations'};
const board={version:2,jobs:[job],sections:[['Today'],['Pipeline'],['Prior history']],adminTasks:[{id:'a',text:'Private reminder',done:true}],admin:{a:true},workLog:[{id:'w',date:'2026-09-22',text:'Reported activity'}]};
const record=b=>({payload:JSON.stringify(b),revision:7});
const facts={verifiedAt:today,evidenceUrl:job.url,postingState:'closed',postingEvidence:'Employer explicitly says this position is no longer available.'};
const packet={expectedRevision:7,updates:[{identity:{company:job.company,role:job.role,url:job.url},facts}]};
const addition={...facts,company:'Another Co',role:'Project Coordinator',url:'https://example.org/jobs/456',evidenceUrl:'https://example.org/jobs/456',postingState:'active',postingEvidence:'Employer application form is accepting applications.',lane:'Operations',fit:'Possible',priority:'Medium',note:'Relevant coordination experience',gap:'Learn their system'};

test('refresh preserves all user-owned fields and board sections exactly',()=>{
  const before=structuredClone(board),p=planMerge(record(board),packet);
  assert.deepEqual(board,before);
  assert.deepEqual(p.board,{...board,jobs:[{...job,...facts}]});
  assert.equal(identity(p.board.jobs[0]),identity(job));
});
test('new jobs are New and not Viewed; no activity is fabricated',()=>{
  const p=planMerge(record(board),{expectedRevision:7,additions:[addition]});
  assert.equal(p.board.jobs[1].status,'New');assert.equal(p.board.jobs[1].viewed,false);
  assert.equal(p.board.jobs[1].userNotes,'');assert.deepEqual(p.board.workLog,board.workLog);
});
test('deduplication covers normalized names, tracking URLs, and duplicates within packet',()=>{
  const dup={...addition,company:' EXAMPLE  CO ',role:'operations coordinator'};
  const tracking={...addition,url:job.url+'?utm_source=email'};
  const p=planMerge(record(board),{expectedRevision:7,additions:[dup,tracking,addition,addition]});
  assert.equal(p.changes.length,1);assert.equal(p.skipped.length,3);
});
test('forbidden fields and arbitrary document paths are rejected',()=>{
  for(const key of ['status','viewed','viewedAt','userNotes','personalNotes','url','priority','note'])
    assert.throws(()=>planMerge(record(board),{...packet,updates:[{...packet.updates[0],facts:{...facts,[key]:'override'}}]}));
  for(const key of ['uid','path','board','admin','sections','workLog'])assert.throws(()=>planMerge(record(board),{...packet,[key]:'override'}));
});
test('pipeline stages beyond New/Reviewing stay untouched',()=>{
  for(const status of ['Ready to Apply','Applied','Interview','Hold','Not interested']){
    const b={...board,jobs:[{...job,status}]},p=planMerge(record(b),packet);
    assert.deepEqual(p.board,b);assert.equal(p.changes.length,0);
  }
});
test('stale revision, unknown target, invalid evidence and oversized result fail closed',()=>{
  assert.throws(()=>planMerge(record(board),{...packet,expectedRevision:6}),/Board changed/);
  assert.throws(()=>planMerge(record(board),{...packet,updates:[{...packet.updates[0],identity:{...packet.updates[0].identity,role:'missing'}}]}),/not found/);
  assert.throws(()=>planMerge(record(board),{...packet,updates:[{...packet.updates[0],facts:{...facts,evidenceUrl:'javascript:alert(1)'}}]}));
  assert.throws(()=>planMerge(record(board),{...packet,updates:[{...packet.updates[0],facts:{...facts,verifiedAt:'2020-01-01'}}]}));
  assert.throws(()=>planMerge(record({...board,sections:[['x'.repeat(700000)]]}),packet),/exceeds/);
});
test('browser three-way sync combines bridge facts with a simultaneous private note edit',()=>{
  const local=structuredClone(board);local.jobs[0].userNotes='New note typed during refresh';
  const remote=planMerge(record(board),packet).board;
  const merged=mergeBoards(board,local,remote).board;
  assert.equal(merged.jobs[0].postingState,'closed');assert.equal(merged.jobs[0].userNotes,local.jobs[0].userNotes);
  assert.deepEqual(merged.adminTasks,board.adminTasks);
});
test('transaction writes only the fixed board and rejects a concurrent revision change',async()=>{
  let data=record(board),writes=0,path;
  const ref={get:async()=>({exists:true,data:()=>data})};
  const db={doc:p=>(path=p,ref),runTransaction:async fn=>fn({get:ref.get,update:(target,fields)=>{assert.equal(target,ref);data={...data,...fields};writes++;}})};
  const service=createBoardService({db,ownerUid:'synthetic-owner',serverTimestamp:()=> 'server-time'});
  await service.preview(packet);assert.equal(writes,0);
  const r=await service.merge(packet);assert.equal(r.revision,8);assert.equal(writes,1);
  assert.equal(path,'users/synthetic-owner/boards/main');
  await assert.rejects(service.merge(packet),/Board changed/);assert.equal(writes,1);
});
test('read-only client is clamped even when token claims merge scope',()=>{
  const cfg={ownerSubject:'owner',readClients:['jumbly'],writeClients:['jamie']};
  assert.deepEqual(authorizeClaims({sub:'owner',azp:'jumbly',scope:'board:read board:merge'},cfg),{canWrite:false});
  assert.equal(authorizeClaims({sub:'owner',azp:'jamie',scope:'board:read board:merge'},cfg).canWrite,true);
  assert.throws(()=>authorizeClaims({sub:'stranger',azp:'jamie',scope:'board:read board:merge'},cfg));
  assert.throws(()=>authorizeClaims({sub:'owner',azp:'unknown',scope:'board:read'},cfg));
});
async function listen(handler){const s=createServer(handler);await new Promise(r=>s.listen(0,'127.0.0.1',r));return {server:s,url:`http://127.0.0.1:${s.address().port}`};}
test('OAuth verifies signature, issuer, audience, expiry, owner, and client',async t=>{
  const {privateKey,publicKey}=await generateKeyPair('RS256');const jwk=await exportJWK(publicKey);jwk.kid='test';
  const {server,url}=await listen((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({keys:[jwk]}));});
  t.after(()=>server.close());
  const cfg={issuer:'https://issuer.example/',publicUrl:'https://bridge.example',jwksUrl:url,ownerSubject:'owner',readClients:['jumbly'],writeClients:['jamie']};
  const auth=createOAuth(cfg);
  const token=async(overrides={})=>new SignJWT({sub:'owner',azp:'jamie',scope:'board:read board:merge',iss:cfg.issuer,aud:cfg.publicUrl+'/mcp',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,...overrides}).setProtectedHeader({alg:'RS256',kid:'test'}).sign(privateKey);
  assert.equal((await auth('Bearer '+await token())).canWrite,true);
  for(const overrides of [{iss:'wrong'},{aud:'wrong'},{exp:1},{sub:'wrong'},{azp:'wrong'}])await assert.rejects(auth('Bearer '+await token(overrides)));
  await assert.rejects(auth('Bearer tampered'));await assert.rejects(auth(undefined));
});
test('MCP auth, discovery, read-only tool enforcement and merge round trip',async t=>{
  let merges=0;
  const service={read:async()=>({board,revision:7}),preview:async p=>({revision:7,changes:planMerge(record(board),p).changes}),merge:async p=>(merges++,{revision:8,changes:planMerge(record(board),p).changes})};
  const {server,url}=await listen(createHandler({service,publicUrl:'https://bridge.example',issuer:'https://issuer.example/',authenticate:async h=>{if(!h){const e=new Error();e.status=401;throw e;}return {canWrite:h==='Bearer writer'};}}));
  t.after(()=>server.close());
  const call=(method,params,token='writer')=>fetch(url+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  assert.equal((await call('tools/list',{},null)).status,401);
  const meta=await (await fetch(url+'/.well-known/oauth-protected-resource/mcp')).json();assert.equal(meta.resource,'https://bridge.example/mcp');
  const reader=await (await call('tools/list',{},'reader')).json();assert.deepEqual(reader.result.tools.map(t=>t.name),['board_read']);
  const blocked=await (await call('tools/call',{name:'board_merge',arguments:packet},'reader')).json();assert.ok(blocked.error||blocked.result?.isError);assert.equal(merges,0);
  const writer=await (await call('tools/list',{})).json();assert.equal(writer.result.tools.length,3);
  const saved=await (await call('tools/call',{name:'board_merge',arguments:packet})).json();assert.equal(JSON.parse(saved.result.content[0].text).revision,8);assert.equal(merges,1);
});

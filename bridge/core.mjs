import {createHash} from 'node:crypto';
import {z} from 'zod';

const text = z.string().max(8000);
const url = z.string().url().max(3000).refine(v => {
  const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password;
}, 'Use an HTTPS posting URL without credentials.');
const date = z.iso.date();
export const identitySchema = z.object({company: text.min(1), role: text.min(1), url: z.string().max(3000)}).strict();
const facts = z.object({location:text.optional(),salary:text.optional(),postingDate:date.optional(),
  linkLabel:text.optional(),verifiedAt:date,evidenceUrl:url,
  postingState:z.enum(['active','closed','unverified']),postingEvidence:text.min(1)}).strict();
const add = facts.extend({company:text.min(1),role:text.min(1),url,
  lane:text,priority:z.enum(['High','Medium','Low']),fit:z.enum(['Strong','Possible','Stretch']),note:text,gap:text}).strict();
export const packetSchema = z.object({
  expectedRevision:z.number().int().nonnegative(),
  additions:z.array(add).max(100).default([]),
  updates:z.array(z.object({identity:identitySchema,facts}).strict()).max(100).default([])
}).strict();
export class BridgeError extends Error {
  constructor(status,message){super(message);this.status=status;}
}
export const identity = j => JSON.stringify([j.company,j.role,j.url||'']);
export const jobKey = j => createHash('sha256').update(identity(j)).digest('hex');
const norm = v => v.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const roleKey = j => JSON.stringify([norm(j.company),norm(j.role)]);
function urlKey(value){
  try{
    const u=new URL(value);u.hash='';
    for(const k of [...u.searchParams.keys()])if(/^utm_|^(gclid|fbclid)$/i.test(k))u.searchParams.delete(k);
    u.searchParams.sort();return u.href.replace(/\/$/,'');
  }catch{return '';}
}
export function readRecord(data){
  if(!data)throw new BridgeError(404,'Existing board not found; bridge will not create or replace it.');
  if(typeof data.payload!=='string'||!Number.isSafeInteger(data.revision)||data.revision<0)throw new BridgeError(409,'Unsupported board record.');
  let board;try{board=JSON.parse(data.payload);}catch{throw new BridgeError(409,'Board payload is not valid JSON.');}
  if(![1,2].includes(board?.version)||!Array.isArray(board.jobs)||board.jobs.length>3000)throw new BridgeError(409,'Unsupported board schema.');
  const seen=new Set();
  for(const j of board.jobs){
    if(!j||typeof j.company!=='string'||typeof j.role!=='string'||typeof j.url!=='string'||
      typeof j.status!=='string'||Object.entries(j).some(([k,v])=>k==='viewed'?typeof v!=='boolean':typeof v!=='string')||seen.has(identity(j)))
      throw new BridgeError(409,'Unsupported or duplicate job record.');
    seen.add(identity(j));
  }
  return {board,revision:data.revision};
}
export function planMerge(data,input,now=new Date()){
  const packet=packetSchema.parse(input),{board,revision}=readRecord(data);
  if(packet.expectedRevision!==revision)throw new BridgeError(409,'Board changed. Read it again and prepare a new preview.');
  const today=now.toISOString().slice(0,10),result=structuredClone(board);
  const changes=[],skipped=[];
  const updateIds=new Set();
  for(const update of packet.updates){
    const key=identity(update.identity);
    if(updateIds.has(key))throw new BridgeError(400,'Duplicate update identity.');
    updateIds.add(key);
    const job=result.jobs.find(j=>identity(j)===key);
    if(!job)throw new BridgeError(409,'Update target not found. Read the board again.');
    if(!['New','Reviewing'].includes(job.status)){skipped.push({jobKey:jobKey(job),reason:'Protected pipeline stage'});continue;}
    checkDates(update.facts,today);
    const fields=Object.keys(update.facts).filter(k=>job[k]!==update.facts[k]);
    if(fields.length){Object.assign(job,update.facts);changes.push({type:'refresh',jobKey:jobKey(job),fields});}
  }
  for(const item of packet.additions){
    checkDates(item,today);
    if(item.postingState!=='active')throw new BridgeError(400,'New jobs must have a verified active posting.');
    const match=result.jobs.find(j=>roleKey(j)===roleKey(item)||(urlKey(j.url)&&urlKey(j.url)===urlKey(item.url)));
    if(match){skipped.push({jobKey:jobKey(match),reason:'Duplicate company/role or posting URL'});continue;}
    const job={...item,status:'New',viewed:false,viewedAt:'',userNotes:'',dateAdded:today};
    result.jobs.push(job);changes.push({type:'add',jobKey:jobKey(job),company:job.company,role:job.role});
  }
  const payload=JSON.stringify(result);
  if(result.jobs.length>3000||Buffer.byteLength(payload)>700000)throw new BridgeError(413,'Result exceeds board limits.');
  return {board:result,payload,revision,changes,skipped};
}
function checkDates(facts,today){
  if(facts.verifiedAt!==today)throw new BridgeError(400,'Verify posting evidence on the current UTC date before sending.');
  if(facts.postingDate&&facts.postingDate>today)throw new BridgeError(400,'Posting date is in the future.');
}
// No model-supplied user ID, document path, delete, replacement, or arbitrary patch.
export function createBoardService({db,ownerUid,serverTimestamp,now=()=>new Date()}){
  if(!ownerUid||ownerUid.includes('/'))throw Error('Set the one board owner UID on the server.');
  const ref=db.doc(`users/${ownerUid}/boards/main`);
  return {
    async read(){const snap=await ref.get();return readRecord(snap.exists?snap.data():null);},
    async preview(packet){const snap=await ref.get();const p=planMerge(snap.exists?snap.data():null,packet,now());return {revision:p.revision,changes:p.changes,skipped:p.skipped};},
    async merge(packet){
      return db.runTransaction(async tx=>{
        const snap=await tx.get(ref),p=planMerge(snap.exists?snap.data():null,packet,now());
        if(!p.changes.length)return {revision:p.revision,changes:[],skipped:p.skipped};
        tx.update(ref,{payload:p.payload,revision:p.revision+1,updatedAt:serverTimestamp()});
        return {revision:p.revision+1,changes:p.changes,skipped:p.skipped};
      });
    }
  };
}

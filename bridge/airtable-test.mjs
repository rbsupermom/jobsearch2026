import {createHash,timingSafeEqual} from 'node:crypto';
import {BridgeError} from './core.mjs';

const text=(value,name,max=500)=>{
  if(typeof value!=='string')throw new BridgeError(400,`${name} must be text.`);
  const v=value.trim();
  if(!v||v.length>max)throw new BridgeError(400,`${name} is invalid.`);
  return v;
};

export function verifyAirtableSecret(provided,expected){
  if(!expected)throw new BridgeError(503,'Airtable bridge is not configured.');
  if(typeof provided!=='string'||!provided)throw new BridgeError(401,'Airtable authentication required.');
  const digest=v=>createHash('sha256').update(v).digest();
  if(!timingSafeEqual(digest(provided),digest(expected)))throw new BridgeError(401,'Airtable authentication failed.');
}

export function parseAirtableTest(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new BridgeError(400,'Invalid Airtable test payload.');
  const allowed=new Set(['recordId','jobId','company','role']);
  if(Object.keys(input).some(k=>!allowed.has(k)))throw new BridgeError(400,'Unknown Airtable test field.');
  const value={
    recordId:text(input.recordId,'recordId',100),
    jobId:text(input.jobId,'jobId',100),
    company:text(input.company,'company'),
    role:text(input.role,'role')
  };
  if(value.jobId!=='TEST-001')throw new BridgeError(400,'Only TEST-001 is accepted by the isolated test route.');
  return value;
}

export function createAirtableTestService({db,ownerUid,serverTimestamp}){
  if(!ownerUid||ownerUid.includes('/'))throw Error('Set the one board owner UID on the server.');
  const ref=db.doc(`users/${ownerUid}/integrations/airtable`);
  return {
    async record(input){
      const value=parseAirtableTest(input);
      await ref.set({
        source:'airtable',
        jobId:value.jobId,
        airtableRecordId:value.recordId,
        company:value.company,
        role:value.role,
        receivedAt:serverTimestamp()
      },{merge:true});
      return {ok:true,jobId:value.jobId,recordId:value.recordId};
    }
  };
}

import {BridgeError} from './core.mjs';

const text=(value,name,max=500)=>{
  if(typeof value!=='string')throw new BridgeError(400,`${name} must be text.`);
  const v=value.trim();
  if(!v||v.length>max)throw new BridgeError(400,`${name} is invalid.`);
  return v;
};

function configText(value,name){
  if(typeof value!=='string'||!value.trim())throw new BridgeError(503,`${name} is not configured.`);
  return value.trim();
}

function airtableHttpError(response){
  const status=Number(response?.status)||0;
  if(status===401)return new BridgeError(502,'Airtable authentication rejected the stored token.');
  if(status===403)return new BridgeError(502,'Airtable rejected access to the configured base or table.');
  if(status===404)return new BridgeError(502,'Airtable could not find the configured base or table.');
  if(status===422)return new BridgeError(502,'Airtable rejected the TEST-001 query.');
  if(status===429)return new BridgeError(502,'Airtable rate-limited the test request.');
  return new BridgeError(502,status?`Airtable API request failed with status ${status}.`:'Airtable API request failed before a status was returned.');
}

export function parseAirtableTestRecord(record){
  if(!record||typeof record!=='object'||Array.isArray(record))throw new BridgeError(502,'Invalid Airtable record response.');
  const fields=record.fields;
  if(!fields||typeof fields!=='object'||Array.isArray(fields))throw new BridgeError(502,'Invalid Airtable fields response.');
  const value={
    recordId:text(record.id,'recordId',100),
    jobId:text(fields['Job ID'],'Job ID',100),
    company:text(fields.Company,'Company'),
    role:text(fields.Role,'Role')
  };
  if(value.jobId!=='TEST-001')throw new BridgeError(502,'Airtable pilot returned a record other than TEST-001.');
  return value;
}

export function createAirtableReader({fetchImpl=globalThis.fetch,pat='',baseId='',tableId=''}){
  return {
    async fetchTest001(){
      const token=configText(pat,'AIRTABLE_PAT');
      const base=configText(baseId,'AIRTABLE_BASE_ID');
      const table=configText(tableId,'AIRTABLE_TABLE_ID');
      if(typeof fetchImpl!=='function')throw new BridgeError(503,'Airtable HTTP client is unavailable.');
      const formula=encodeURIComponent(`{Job ID}='TEST-001'`);
      const url=`https://api.airtable.com/v0/${encodeURIComponent(base)}/${encodeURIComponent(table)}?maxRecords=2&filterByFormula=${formula}`;
      let response;
      try{
        response=await fetchImpl(url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});
      }catch{
        throw new BridgeError(502,'Airtable request could not reach the API.');
      }
      if(!response||!response.ok)throw airtableHttpError(response);
      let body;
      try{body=await response.json();}catch{throw new BridgeError(502,'Airtable returned invalid JSON.');}
      if(!body||!Array.isArray(body.records))throw new BridgeError(502,'Airtable response did not include a records array.');
      if(body.records.length===0)throw new BridgeError(502,'Airtable TEST-001 lookup returned no records.');
      if(body.records.length>1)throw new BridgeError(502,'Airtable TEST-001 lookup returned more than one record.');
      return parseAirtableTestRecord(body.records[0]);
    }
  };
}

export function createAirtableTestService({db,ownerUid,serverTimestamp,airtable}){
  if(!ownerUid||ownerUid.includes('/'))throw Error('Set the one board owner UID on the server.');
  const ref=db.doc(`users/${ownerUid}/integrations/airtable`);
  const record=async value=>{
    if(!value||value.jobId!=='TEST-001')throw new BridgeError(400,'Only TEST-001 is accepted by the isolated test service.');
    await ref.set({
      source:'airtable',
      jobId:value.jobId,
      airtableRecordId:value.recordId,
      company:value.company,
      role:value.role,
      receivedAt:serverTimestamp()
    },{merge:true});
    return {ok:true,jobId:value.jobId};
  };
  return {
    record,
    async pull(){
      if(!airtable||typeof airtable.fetchTest001!=='function')throw new BridgeError(503,'Airtable bridge is not configured.');
      return record(await airtable.fetchTest001());
    }
  };
}

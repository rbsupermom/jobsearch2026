import {initializeApp,applicationDefault,cert} from 'firebase-admin/app';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {configFromEnv,createOAuth} from './auth.mjs';
import {createBoardService} from './core.mjs';
import {createHandler} from './handler.mjs';
import {createAirtableReader,createAirtableTestService} from './airtable-test.mjs';

let handler;
export function productionHandler(){
  if(handler)return handler;
  const cfg=configFromEnv(process.env);
  // Credentials are only supplied through the host's private secret settings.
  let credential=applicationDefault();
  if(process.env.FIREBASE_SERVICE_ACCOUNT_JSON){
    const account=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if(account.project_id!=='job-search-command-board')throw Error('Wrong Firebase project.');
    credential=cert(account);
  }
  const app=initializeApp({projectId:'job-search-command-board',credential});
  const db=getFirestore(app);
  const serverTimestamp=()=>FieldValue.serverTimestamp();
  const service=createBoardService({db,ownerUid:cfg.ownerUid,serverTimestamp});
  const airtable=createAirtableReader({
    pat:process.env.AIRTABLE_PAT||'',
    baseId:process.env.AIRTABLE_BASE_ID||'',
    tableId:process.env.AIRTABLE_TABLE_ID||''
  });
  const airtableTest=createAirtableTestService({db,ownerUid:cfg.ownerUid,serverTimestamp,airtable});
  handler=createHandler({
    service,
    authenticate:createOAuth(cfg),
    publicUrl:cfg.publicUrl,
    issuer:cfg.issuer,
    airtableTest
  });
  return handler;
}

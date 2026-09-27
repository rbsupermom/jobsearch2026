import {initializeApp,applicationDefault,cert} from 'firebase-admin/app';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {configFromEnv,createOAuth} from './auth.mjs';
import {createBoardService} from './core.mjs';
import {createHandler} from './handler.mjs';

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
  const service=createBoardService({db:getFirestore(app),ownerUid:cfg.ownerUid,serverTimestamp:()=>FieldValue.serverTimestamp()});
  handler=createHandler({service,authenticate:createOAuth(cfg),publicUrl:cfg.publicUrl,issuer:cfg.issuer});
  return handler;
}

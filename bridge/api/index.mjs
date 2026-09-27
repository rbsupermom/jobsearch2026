import {productionHandler} from '../runtime.mjs';
export default async function handler(req,res){
  try{return await productionHandler()(req,res);}
  catch{res.statusCode=503;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify({error:'Bridge is not configured.'}));}
}

import {createRemoteJWKSet,jwtVerify} from 'jose';
import {BridgeError} from './core.mjs';

export function authorizeClaims(p,cfg){
  if(p.sub!==cfg.ownerSubject)throw new BridgeError(403,'Account is not authorized for this board.');
  const client=p.azp??p.client_id;
  const isWriter=cfg.writeClients.includes(client),isReader=cfg.readClients.includes(client);
  if(!isWriter&&!isReader)throw new BridgeError(403,'OAuth client is not authorized.');
  const scope=new Set(typeof p.scope==='string'?p.scope.split(' '):[]);
  if(!scope.has('board:read'))throw new BridgeError(403,'Missing board:read scope.');
  return {canWrite:isWriter&&scope.has('board:merge')};
}
export function createOAuth(cfg){
  const jwks=createRemoteJWKSet(new URL(cfg.jwksUrl));
  return async header=>{
    if(typeof header!=='string'||!/^Bearer [^\s]+$/.test(header))throw new BridgeError(401,'Authentication required.');
    let payload;
    try{({payload}=await jwtVerify(header.slice(7),jwks,{issuer:cfg.issuer,audience:cfg.publicUrl+'/mcp',
      algorithms:['RS256','ES256'],requiredClaims:['exp','sub','iat']}));}
    catch{throw new BridgeError(401,'Invalid or expired access token.');}
    return authorizeClaims(payload,cfg);
  };
}
export function configFromEnv(env){
  const required=name=>{if(!env[name])throw Error(`Missing server setting ${name}`);return env[name];};
  const https=name=>{const v=required(name),u=new URL(v);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error(`Invalid HTTPS setting ${name}`);return v;};
  const cfg={publicUrl:https('BRIDGE_PUBLIC_URL').replace(/\/$/,''),issuer:https('OAUTH_ISSUER'),
    jwksUrl:https('OAUTH_JWKS_URL'),ownerSubject:required('OAUTH_OWNER_SUBJECT'),
    writeClients:required('OAUTH_WRITE_CLIENT_IDS').split(',').map(x=>x.trim()).filter(Boolean),
    readClients:(env.OAUTH_READ_CLIENT_IDS||'').split(',').map(x=>x.trim()).filter(Boolean),
    ownerUid:required('BOARD_OWNER_UID')};
  if(cfg.writeClients.some(c=>cfg.readClients.includes(c)))throw Error('Reader and writer client IDs must be different.');
  return cfg;
}

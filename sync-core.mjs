const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const copy=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
const key=(item,path)=>path==='jobs'?JSON.stringify([item.company,item.role,item.url||'']):item.id;
export class BoardConflict extends Error {
 constructor(paths){super('The same information changed on another device.');this.name='BoardConflict';this.paths=paths;}
}
// Three-way merge: compare both devices with the last acknowledged cloud version.
// Different fields combine; conflicting changes to one field require a decision.
export function mergeBoards(base,local,remote,preference){
 const conflicts=[];
 function merge(b,l,r,path){
  if(same(l,r))return copy(l);
  if(same(b,l))return copy(r);
  if(same(b,r))return copy(l);
  if(['jobs','adminTasks','workLog'].includes(path)&&[b,l,r].every(Array.isArray)){
   const maps=[b,l,r].map(a=>new Map(a.map(v=>[key(v,path),v])));
   const ids=[...new Set([...maps[0].keys(),...maps[1].keys(),...maps[2].keys()])];
   return ids.map(id=>merge(...maps.map(m=>m.get(id)),path+'/'+id)).filter(v=>v!==undefined);
  }
  if([b,l,r].every(v=>v&&typeof v==='object'&&!Array.isArray(v))){
   const result={};for(const k of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])){
    const v=merge(b[k],l[k],r[k],path?path+'/'+k:k);if(v!==undefined)Object.defineProperty(result,k,{value:v,enumerable:true,writable:true,configurable:true});
   }return result;
  }
  conflicts.push(path);return copy(preference==='remote'?r:l);
 }
 const board=merge(base,local,remote,'');
 if(conflicts.length&&!preference)throw new BoardConflict(conflicts);
 return {board,conflicts};
}
export const emptyBoard=()=>({version:2,jobs:[],sections:[],adminTasks:[],admin:{},workLog:[]});

import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,onAuthStateChanged,signOut} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {getFirestore,doc,onSnapshot,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import {firebaseConfig} from './firebase-config.js';
import {mergeBoards,emptyBoard,BoardConflict} from './sync-core.mjs?v=20260925-3';
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
const $=id=>document.getElementById(id),clone=x=>JSON.parse(JSON.stringify(x));
const say=text=>{$('saveStatus').textContent=text;};
let user=null,ref=null,unsubscribe=null,base=emptyBoard(),desired=emptyBoard(),dirty=false,ready=false,busy=false,timer=null,conflict=null,generation=0;
let latestRemote=null,committedRevision=0;
const cacheKey=()=>`jobsearch2026.cloud-draft.${user.uid}`;
function cache(){
 if(!user)return;
 try{localStorage.setItem(cacheKey(),JSON.stringify({base,desired,dirty}));}
 catch{say('Device backup could not be saved. Keep this page open until synced, or export a private backup.');}
}
function gate(enabled){
 document.querySelectorAll('#board input,#board select,#board textarea,#dailyExecution input,#importFile,#restoreFile').forEach(el=>el.disabled=!enabled);
 window.boardUI.editable=enabled;
 document.querySelectorAll('#board article').forEach(el=>el.draggable=enabled);
}
function apply(board){window.boardUI.apply(board);gate(ready);}
function read(snapshot){return snapshot.exists()?window.boardUI.validate(JSON.parse(snapshot.data().payload)):emptyBoard();}
function schedule(){clearTimeout(timer);if(ready&&dirty&&!conflict)timer=setTimeout(flush,1200);}
function setConflict(error,remote){
 conflict={remote,local:clone(desired),base:clone(base)};
 $('conflict').hidden=false;$('conflictText').textContent=`${error.paths?.length||1} field(s) changed differently on another device. Both versions are preserved. Choose which version to use for those fields; other edits will be combined.`;
 say('Sync paused: conflicting changes need your decision.');
}
async function flush(){
 if(!ready||!dirty||busy||conflict||!ref)return;
 if(!navigator.onLine){say('Offline — edits are saved on this device and will sync when connected.');return;}
 busy=true;const token=generation, sent=clone(desired),start=clone(base),target=ref;let remoteSeen;
 say('Syncing…');
 try{
  const result=await runTransaction(db,async tx=>{
   const snapshot=await tx.get(target);const remote=read(snapshot);remoteSeen=remote;
   const merged=mergeBoards(start,sent,remote).board;
   const payload=JSON.stringify(merged);if(new TextEncoder().encode(payload).length>700000)throw Error('Board is too large to sync. Export a backup and reduce its size.');
   const revision=(snapshot.exists()?snapshot.data().revision:0)+1;
   tx.set(target,{payload,revision,updatedAt:serverTimestamp()});return {board:merged,revision};
  });
  if(token!==generation)return;
  // Retain edits made while the transaction was in flight.
  const current=clone(desired);base=result.board;committedRevision=result.revision;
  try{desired=mergeBoards(sent,current,result.board).board;}
  catch(e){desired=current;setConflict(e,result.board);cache();return;}
  dirty=JSON.stringify(desired)!==JSON.stringify(base);cache();apply(desired);
  say(dirty?'New edits waiting to sync…':'Synced across your devices.');
 }catch(error){
  if(token!==generation)return;
  if(error instanceof BoardConflict)setConflict(error,remoteSeen);
  else say(`Not synced — ${error.message||'connection failed'}. Your device copy is retained. Use Retry sync or export a backup.`);
  cache();
 }finally{if(token===generation){busy=false;if(!dirty&&!conflict&&latestRemote?.revision>committedRevision){base=latestRemote.board;desired=base;cache();apply(desired);}if(dirty&&!conflict&&navigator.onLine&&JSON.stringify(desired)!==JSON.stringify(sent))schedule();}}
}
window.cloudBoard={
 queue(board){
  if(!ready){say('Sign in and wait for your cloud board before editing.');return false;}
  desired=clone(board);dirty=true;cache();say(navigator.onLine?'Saved on this device; syncing shortly…':'Offline — saved on this device, waiting to sync.');schedule();return false;
 },
 isReady:()=>ready
};
$('signIn').addEventListener('click',async()=>{
 try{const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});await signInWithPopup(auth,provider);}
 catch(e){say(`Sign-in did not complete: ${e.message}. Allow the Google sign-in popup and try again.`);}
});
$('signOut').addEventListener('click',async()=>{
 if(dirty&&!confirm('Some edits are not synced. Export a private backup first. Sign out while retaining the device draft?'))return;
 try{await signOut(auth);}catch(e){say('Sign-out failed: '+e.message);}
});
$('retrySync').addEventListener('click',()=>{if(conflict)say('Resolve the conflicting fields below first.');else flush();});
for(const choice of ['local','remote'])$(choice==='local'?'keepLocal':'keepRemote').addEventListener('click',()=>{
 if(!conflict)return;
 // The next transaction still detects any newer changes made after this decision.
 desired=mergeBoards(conflict.base,desired,conflict.remote,choice).board;base=conflict.remote;dirty=true;conflict=null;$('conflict').hidden=true;cache();apply(desired);flush();
});
$('exportCloud').addEventListener('click',()=>{if(conflict)window.boardUI.download(conflict.remote,'cloud-conflict-backup');});
onAuthStateChanged(auth,async account=>{
 generation++;clearTimeout(timer);if(unsubscribe)unsubscribe();unsubscribe=null;user=account;ref=null;ready=false;busy=false;conflict=null;dirty=false;latestRemote=null;committedRevision=0;base=emptyBoard();desired=emptyBoard();$('conflict').hidden=true;
 $('signIn').hidden=!!account;$('signOut').hidden=!account;$('account').textContent=account?`Signed in as ${account.email||'your account'}`:'Sign in with the same Google account on every device.';apply(emptyBoard());
 if(!account){say('Sign in to load your private board.');return;}
 say('Loading your private cloud board…');ref=doc(db,'users',account.uid,'boards','main');
 let draft=null;
 try{const raw=localStorage.getItem(cacheKey());if(raw){draft=JSON.parse(raw);draft.base=window.boardUI.validate(draft.base);draft.desired=window.boardUI.validate(draft.desired);}}
 catch{say('Your device draft could not be read. It has been left untouched. Export it before continuing.');return;}
 const token=generation;
 unsubscribe=onSnapshot(ref,{includeMetadataChanges:true},snapshot=>{
  if(token!==generation||snapshot.metadata.hasPendingWrites||snapshot.metadata.fromCache)return;
  try{
   const remote=read(snapshot);
   latestRemote={board:remote,revision:snapshot.exists()?snapshot.data().revision:0};
   if(!ready){
    if(draft?.dirty){base=draft.base;desired=draft.desired;dirty=true;try{desired=mergeBoards(base,desired,remote).board;base=remote;}catch(e){setConflict(e,remote);}}
    else{base=remote;desired=remote;dirty=false;}
    ready=true;apply(desired);cache();if(dirty)schedule();else say(snapshot.exists()?'Synced across your devices.':'Your private cloud board is ready. Import your latest private backup once.');
   }else if(!busy&&!dirty&&!conflict){base=remote;desired=remote;cache();apply(desired);say('Synced across your devices.');}
  }catch(e){say('Cloud data could not be loaded safely: '+e.message);gate(false);}
 },error=>{ready=false;gate(false);say('Cloud access failed: '+error.message+'. Your saved device draft is retained.');});
});
window.addEventListener('online',()=>{if(dirty)flush();});
window.addEventListener('offline',()=>say(dirty?'Offline — your edits are waiting to sync.':'Offline — showing your last loaded board.'));
window.addEventListener('beforeunload',e=>{if(dirty){cache();e.preventDefault();e.returnValue='';}});
gate(false);

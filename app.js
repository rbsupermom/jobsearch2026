'use strict';
const columns=['New','Reviewing','Ready to Apply','Applied','Interview','Hold'];
let state={version:2,jobs:[],sections:[],adminTasks:[]};
const $=id=>document.getElementById(id);
const report=text=>{$('saveStatus').textContent=text;};
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const identity=j=>JSON.stringify([j.company,j.role,j.url||'']);
const safeURL=url=>{try{const u=new URL(url);return ['https:','http:'].includes(u.protocol)?u.href:'#';}catch{return '#';}};
function validate(value){
 if(!value||![1,2].includes(value.version)||!Array.isArray(value.jobs)||value.jobs.length>3000)throw Error('Choose a supported private board JSON backup.');
 const seen=new Set();
 const jobs=value.jobs.map(j=>{
  if(!j||typeof j.company!=='string'||!j.company.trim()||typeof j.role!=='string'||!j.role.trim()||!columns.includes(j.status))throw Error('A job has missing details or an unsupported status. Nothing was imported.');
  for(const [k,v] of Object.entries(j)){if(!['viewed'].includes(k)&&typeof v!=='string')throw Error('A job field is not valid text. Nothing was imported.');}
  if(j.viewed!==undefined&&typeof j.viewed!=='boolean')throw Error('Invalid Viewed value.');
  const key=identity(j);if(seen.has(key))throw Error('Duplicate job identity in backup. Nothing was imported.');seen.add(key);
  return {...j,userNotes:j.userNotes??j.personalNotes??'',viewed:j.viewed??false,viewedAt:j.viewedAt??''};
 });
 const sections=value.sections??[];
 if(!Array.isArray(sections)||sections.length>3||sections.some(s=>!Array.isArray(s)||s.some(t=>typeof t!=='string')))throw Error('Invalid execution sections.');
 const adminTasks=value.adminTasks??[];
 if(!Array.isArray(adminTasks)||adminTasks.length>100||adminTasks.some(t=>!t||typeof t.id!=='string'||typeof t.text!=='string'||typeof t.done!=='boolean')||new Set(adminTasks.map(t=>t.id)).size!==adminTasks.length)throw Error('Invalid ADMIN items.');
 // Retain older backup completion flags even if task labels arrive in a later import.
 const admin=value.admin??{};
 if(!admin||typeof admin!=='object'||Array.isArray(admin)||Object.values(admin).some(v=>typeof v!=='boolean'))throw Error('Invalid ADMIN completion values.');
 const workLog=value.workLog??[];
 if(!Array.isArray(workLog)||workLog.length>3000||workLog.some(e=>!e||typeof e.id!=='string'||typeof e.date!=='string'||typeof e.text!=='string')||new Set(workLog.map(e=>e.id)).size!==workLog.length)throw Error('Invalid work-search log.');
 return {version:2,jobs,sections,adminTasks,admin,workLog};
}
function save(){
 if(window.cloudBoard)return window.cloudBoard.queue(state);
 report('Cloud connection is not ready. Sign in before editing.');return false;
}
function exportBackup(){
 const url=URL.createObjectURL(new Blob([JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download='Job_Search_Private_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function merge(incoming){
 if(!state.jobs.length&&!state.sections.length&&!state.adminTasks.length){state=incoming;return {added:incoming.jobs.length,kept:0};}
 const existing=new Set(state.jobs.map(identity));let added=0,kept=0;
 for(const job of incoming.jobs){if(existing.has(identity(job))){kept++;}else{state.jobs.push(job);existing.add(identity(job));added++;}}
 if(!state.sections.length)state.sections=incoming.sections;
 for(const task of incoming.adminTasks){if(!state.adminTasks.some(t=>t.id===task.id))state.adminTasks.push({...task,done:state.admin?.[task.id]??task.done});}
 state.admin={...incoming.admin,...state.admin};
 state.workLog??=[];for(const entry of incoming.workLog??[]){if(!state.workLog.some(e=>e.id===entry.id))state.workLog.push(entry);}
 return {added,kept};
}
function renderSections(){
 const wrap=$('dailyExecution');wrap.replaceChildren();
 ['TODAY','PIPELINE','WORK-SEARCH LOG','ADMIN'].forEach((title,i)=>{
  const card=document.createElement('div');card.className='card';const heading=document.createElement('h2');heading.textContent=title;card.append(heading);
  if(i<3){
   const lines=state.sections[i];
   if(lines?.length){for(const text of lines){const p=document.createElement('p');p.textContent=text;card.append(p);}}
   else{const p=document.createElement('p');p.textContent='Import your private board to view this section.';card.append(p);}
   if(i===1&&state.jobs.length){const p=document.createElement('p');p.textContent=`Currently tracked: ${state.jobs.length}`;card.append(p);}
   if(i===2&&state.jobs.length){
    const h=document.createElement('h3');h.textContent='Completed activities you report';card.append(h);
    for(const entry of state.workLog??[]){const p=document.createElement('p');p.textContent=`${entry.date}: ${entry.text}`;card.append(p);}
    const date=document.createElement('input');date.type='date';date.setAttribute('aria-label','Completed activity date');date.value=new Date().toLocaleDateString('en-CA');
    const text=document.createElement('input');text.placeholder='What did you complete?';text.setAttribute('aria-label','Completed activity description');text.maxLength=2000;
    const add=document.createElement('button');add.type='button';add.textContent='Record completed activity';
    add.addEventListener('click',()=>{if(!window.cloudBoard?.isReady())return;if(!date.value||!text.value.trim()){report('Enter the activity date and what you completed.');return;}state.workLog??=[];state.workLog.push({id:crypto.randomUUID(),date:date.value,text:text.value.trim()});save();render();});
    const note=document.createElement('p');note.textContent='Record only activities you completed. This does not determine benefit eligibility. Imported figures above are dated source context.';card.append(date,text,add,note);
   }
  }else{
   if(!state.adminTasks.length){const p=document.createElement('p');p.textContent='No private reminders imported.';card.append(p);}
   state.adminTasks.forEach(task=>{const label=document.createElement('label');label.className='admin-task';const input=document.createElement('input');input.type='checkbox';input.checked=task.done;input.dataset.admin=task.id;input.addEventListener('change',()=>{task.done=input.checked;save();});label.append(input,document.createTextNode(task.text));card.append(label);});
  }wrap.append(card);
 });
}
function render(){
 $('empty').hidden=state.jobs.length>0;
 document.querySelector('.sub').textContent=state.jobs.length?`${state.jobs.length} tracked roles · saved in this browser`:'Sign in to load your private board on any device.';
 renderSections();
 const q=$('search').value.toLowerCase(),lane=$('lane').value,fit=$('fit').value,pri=$('priority').value,viewed=$('viewedFilter').value;
 const laneSelect=$('lane');laneSelect.replaceChildren(new Option('All lanes',''));[...new Set(state.jobs.map(j=>j.lane).filter(Boolean))].sort().forEach(s=>laneSelect.add(new Option(s,s)));laneSelect.value=lane;
 const filtered=state.jobs.filter(j=>(!q||`${j.company} ${j.role} ${j.lane} ${j.note} ${j.userNotes}`.toLowerCase().includes(q))&&(!lane||j.lane===lane)&&(!fit||j.fit===fit)&&(!pri||j.priority===pri)&&(!viewed||(viewed==='viewed'?j.viewed:!j.viewed)));
 const board=$('board');board.replaceChildren();
 columns.forEach(col=>{
  const date=j=>{const n=Date.parse(j.postingDate||j.dateAdded||'');return Number.isFinite(n)?n:0;};
  const matches=filtered.filter(j=>j.status===col).sort((a,b)=>date(b)-date(a));
  const section=document.createElement('section');section.className='column';section.dataset.status=col;
  section.innerHTML=`<div class="column-head"><h2>${col}</h2><span class="count">${matches.length}</span></div>`;
  matches.forEach(j=>{
   const card=document.createElement('article');card.className='card'+(j.viewed?' viewed':'');card.draggable=true;card.dataset.idx=state.jobs.indexOf(j);
   card.innerHTML=`<h3>${esc(j.role)}</h3><div class="company">${esc(j.company)}</div><div class="badges"><span class="badge ${esc(String(j.priority).toLowerCase())}">${esc(j.priority)} priority</span><span class="badge ${esc(String(j.fit).toLowerCase())}">${esc(j.fit)} fit</span><span class="badge">${esc(j.lane)}</span></div><div class="meta">${esc(j.location)}<br>${esc(j.salary)}</div><div class="note">${esc(j.note)}</div><div class="gap"><b>Learn / gap:</b> ${esc(j.gap)}</div><a class="joblink" href="${esc(safeURL(j.url))}" target="_blank" rel="noopener noreferrer">${esc(j.linkLabel||'View job')}</a><div class="viewed-row"><label class="viewed-toggle"><input type="checkbox" ${j.viewed?'checked':''}> Viewed</label><span class="viewed-date">${esc(j.viewedAt)}</span></div><label>Status <select aria-label="Status for ${esc(j.company)} ${esc(j.role)}">${columns.map(s=>`<option ${s===j.status?'selected':''}>${s}</option>`).join('')}</select></label><div class="card-actions"><button type="button">Notes${j.userNotes?' •':''}</button></div><div class="notes-wrap"><textarea class="notes-area" aria-label="Notes for ${esc(j.company)} ${esc(j.role)}" placeholder="Add your notes about this role…">${esc(j.userNotes)}</textarea><div class="notes-status">See the sync message above for cloud save confirmation.</div></div>`;
   card.querySelector('input').addEventListener('change',e=>{j.viewed=e.target.checked;j.viewedAt=j.viewed?new Date().toLocaleDateString():'';save();render();});
   card.querySelector('select').addEventListener('change',e=>{j.status=e.target.value;save();render();});
   card.querySelector('button').addEventListener('click',()=>card.querySelector('.notes-wrap').classList.toggle('open'));
   const notes=card.querySelector('textarea');notes.value=j.userNotes;notes.addEventListener('input',()=>{j.userNotes=notes.value;save();});notes.addEventListener('focus',()=>card.draggable=false);notes.addEventListener('blur',()=>card.draggable=true);
   card.addEventListener('dragstart',e=>{if(e.target.closest('textarea,input,select,button,a')){e.preventDefault();return;}card.classList.add('dragging');e.dataTransfer.setData('text/plain',card.dataset.idx);});card.addEventListener('dragend',()=>card.classList.remove('dragging'));section.append(card);
  });
  section.addEventListener('dragover',e=>{e.preventDefault();section.classList.add('over');});section.addEventListener('dragleave',()=>section.classList.remove('over'));section.addEventListener('drop',e=>{e.preventDefault();section.classList.remove('over');const dragged=board.querySelector('.dragging');if(!dragged)return;state.jobs[Number(dragged.dataset.idx)].status=col;save();render();});board.append(section);
 });
 $('stats').innerHTML=[['tracked',state.jobs.length],['high priority',state.jobs.filter(j=>j.priority==='High').length],['strong fit',state.jobs.filter(j=>j.fit==='Strong').length],['applied',state.jobs.filter(j=>j.status==='Applied').length],['interviews',state.jobs.filter(j=>j.status==='Interview').length],['viewed',state.jobs.filter(j=>j.viewed).length]].map(([label,n])=>`<div class="stat"><b>${n}</b>${label}</div>`).join('');
 if(!window.boardUI?.editable){document.querySelectorAll('#board input,#board select,#board textarea,#dailyExecution input,#importFile').forEach(el=>el.disabled=true);document.querySelectorAll('#board article').forEach(el=>el.draggable=false);}
}
$('importFile').addEventListener('change',async e=>{
 const file=e.target.files[0];if(!file)return;
 try{
  if(!window.cloudBoard?.isReady())throw Error('Sign in and wait for your cloud board before importing.');
  if(file.size>10*1024*1024)throw Error('Backup is too large (maximum 10 MB).');
  const incoming=validate(JSON.parse(await file.text()));
  const result=merge(incoming);const saved=save();render();
  if(saved)report(`Imported ${result.added} roles; preserved ${result.kept} existing roles, including notes and statuses. Saved in this browser.`);
 }catch(error){report(error.message||'Import failed. Nothing changed.');}finally{e.target.value='';}
});
$('exportData').addEventListener('click',exportBackup);
['search','lane','fit','priority','viewedFilter'].forEach(id=>$(id).addEventListener('input',render));
$('reset').addEventListener('click',()=>{['search','lane','fit','priority','viewedFilter'].forEach(id=>$(id).value='');render();});
$('filterToggle').addEventListener('click',()=>{const open=$('controlsWrap').classList.toggle('open');$('filterToggle').setAttribute('aria-expanded',String(open));$('filterToggle').textContent=open?'Filters ▴':'Filters ▾';});
window.boardUI={
 editable:false,
 validate,
 download(board,name){const url=URL.createObjectURL(new Blob([JSON.stringify(board,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);},
 apply(board){
  const active=document.activeElement,card=active?.closest?.('article');
  const focused=active?.tagName==='TEXTAREA'&&card?{key:identity(state.jobs[Number(card.dataset.idx)]),start:active.selectionStart,end:active.selectionEnd}:null;
  state=validate(board);render();
  if(focused){const idx=state.jobs.findIndex(j=>identity(j)===focused.key);const next=document.querySelector(`article[data-idx="${idx}"] textarea`);if(next){next.closest('.notes-wrap').classList.add('open');next.focus();next.setSelectionRange(focused.start,focused.end);}}
 }
};
render();


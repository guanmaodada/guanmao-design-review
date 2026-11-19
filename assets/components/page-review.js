/* Local-only design review helper. No product requests or full-state capture. */
(function () {
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const prefix='design-page-review:';
const memory=Object.create(null),dirty=Object.create(null),receiptCatalog=Object.create(null);
const filled=n=>Boolean(n.text.trim()||n.images?.length);
const imageStore=project=>window.ReviewImages?.store(prefix+project);
const normalize=v=>String(v??'').replace(/\r\n?/g,'\n').trim();
function configure({project,receipts=[]}){receiptCatalog[project]=receipts.filter(r=>typeof r.id==='string'&&typeof r.text==='string'&&typeof r.progress==='string')}
function receiptFor(n){return (receiptCatalog[n.project]||[]).find(r=>r.id===n.id&&normalize(r.text)===normalize(n.text))}
function progress(n){return n.status==='已处理'?'已处理':receiptFor(n)?.progress||n.status}
function progressHTML(n){const r=receiptFor(n);return esc('修改进展：'+progress(n)+(r?'；'+r.processedAt+' '+r.message:''))}
function transaction(project,op,note,notify=true){
 const key=prefix+project;
 const empty=()=>({schema:1,project,notes:Object.create(null)});
 let persistent=true,message='',db;
 try {
  const raw=localStorage.getItem(key);
  db=raw?JSON.parse(raw):empty();
  if(db?.schema!==1||db.project!==project||!db.notes||typeof db.notes!=='object'||Array.isArray(db.notes)) throw Error('格式');
 } catch {
  persistent=false;
  message='浏览器存储不可用或原数据无法读取。本次仅保留在当前页面，请导出备份。';
  db=memory[key]||empty();
 }
 if(dirty[key]){
  db=memory[key]||db;
  if(op==='all'){persistent=false;message='仍有未写入浏览器的意见，请导出备份。';}
 }
 const previous=note&&Object.hasOwn(db.notes,note.id)?db.notes[note.id]:null;
 if(op==='merge'&&previous&&note.updatedAt<=previous.updatedAt)return {db,persistent,message};
 const previousImages=previous?.images||[];
 if(op==='upsert'||op==='merge')Object.defineProperty(db.notes,note.id,{value:note,enumerable:true,configurable:true,writable:true});
 if(op==='delete')delete db.notes[note.id];
 if(op!=='all'){
  if(persistent){
   try {
    localStorage.setItem(key,JSON.stringify(db));
    if(previousImages.length){
     const retained=new Set(Object.values(db.notes).flatMap(record=>(record.images||[]).map(image=>image.id)));
     for(const image of previousImages)if(!retained.has(image.id))imageStore(project)?.remove(image.id).catch(()=>{});
    }
   }
   catch {persistent=false;message='本地保存失败。本次仅保留在当前页面，请导出备份。';}
  }
  dirty[key]=!persistent;
 }
 memory[key]=db;
 if(notify&&op!=='all')window.dispatchEvent(new CustomEvent('design-review-local-change',{detail:{project}}));
 return {db,persistent,message};
}
// Trusted parent brokers storage for an opaque, sandboxed srcdoc child.
function broker(frame,project){const images=imageStore(project);window.addEventListener('message',async ev=>{
 const m=ev.data;if(ev.source!==frame.contentWindow||m?.type!=='design-review-store'||m.project!==project||typeof m.op!=='string')return;
 if(m.op.startsWith('image-')){
  if(!images || typeof m.note?.id!=='string' || m.note.id.length>128) return;
  let data;
  try {
   if(m.op==='image-get')data=await images.get(m.note.id);
   if(m.op==='image-put'&&ReviewImages.validData(m.note.data))data=await images.put(m.note.id,m.note.data);
  } catch {}
  ev.source.postMessage({type:'design-review-result',request:m.request,data},'*');
  return;
 }
 if(!['all','upsert','merge','delete'].includes(m.op))return;
 if(m.op!=='all'&&(!valid(m.note)||m.note.project!==project))return;
 const result=transaction(project,m.op,m.note,false);ev.source.postMessage({type:'design-review-result',request:m.request,...result},'*');
 });}
function valid(n, portable=false){
 if(!n||typeof n.id!=='string'||n.id.length>=250||['__proto__','constructor','prototype'].includes(n.id)||
  typeof n.text!=='string'||n.text.length>20000||typeof n.title!=='string'||n.title.length>=500||
  !['待讨论','已确认修改','已处理'].includes(n.status))return false;
 if(n.images===undefined)return true;
 if(!Array.isArray(n.images))return false;
 return !n.images.length||(window.ReviewImages&&n.images.every(img=>ReviewImages.valid(img,portable))&&
  new Set(n.images.map(img=>img.number)).size===n.images.length);
}
function create({project,onResize=()=>{}}){
 let db={schema:1,project,notes:{}},host,context,warning='',ready=false,showAll=false,pending=0,serial=0,version=0;
 const queue=new Map();
 const localImages=imageStore(project);
 const images=window.parent===window?localImages:{
  get:id=>call('image-get',{id}).then(result=>result.data),
  put:(id,data)=>call('image-put',{id,data}).then(result=>result.data),
 };
 const uploads=new Set();
 async function waitForUploads(){await Promise.all(uploads);}

 function call(op,note){
  if(window.parent===window)return Promise.resolve(transaction(project,op,note));
  const request=project+':'+(++serial)+':'+Date.now();return new Promise(resolve=>{const timer=setTimeout(()=>{queue.delete(request);resolve({db,persistent:false,message:'评审保存没有收到确认，请导出备份后再关闭页面。'})},1800);queue.set(request,{resolve,timer});parent.postMessage({type:'design-review-store',project,op,note,request},'*')});
 }
 window.addEventListener('message',ev=>{const m=ev.data;if(ev.source!==parent||m?.type!=='design-review-result'||!queue.has(m.request))return;const p=queue.get(m.request);clearTimeout(p.timer);queue.delete(m.request);p.resolve(m)});
 const loading=call('all').then(r=>{db=r.db;warning=r.message;ready=true;draw()});
 function note(target=context){
  if(Object.hasOwn(db.notes,target.id))return db.notes[target.id];
  return {id:target.id,project,title:target.title,section:target.section,context:target.description||'',text:'',status:'待讨论',updatedAt:'',images:[],imageSeq:0};
 }
 function save(text,status,imageFields,target=context){
  if(!ready||!target)return;
  const prior=note(target);
  if((normalize(text)!==normalize(prior.text)||imageFields)&&status==='已处理'){
    status='待讨论';
    const select=host.querySelector('[data-pr-select]');
    if(select&&target.id===context.id)select.value=status;
  }
  const n={...prior,...imageFields,title:target.title,section:target.section,context:target.description||'',text,status,updatedAt:new Date().toISOString()};
  db.notes[n.id]=n;
  const current=++version;
  pending++;
  statusText('保存中…');
  return call('upsert',n).then(r=>{
    pending--;
    warning=r.message;
    if(current===version){db=r.db;statusText(warning||'已自动保存到当前浏览器');counts();refreshProgress();}
    onResize();
  });
 }
 function statusText(s){if(host?.isConnected){const n=host.querySelector('[data-pr-status]');if(n){n.textContent=s;n.classList.toggle('pr-warning',!!warning)}}}
 function refreshProgress(){const box=host?.querySelector('[data-pr-progress]');if(box)box.innerHTML=progressHTML(note())}
 function counts(){
  if(!host?.isConnected)return;
  const n=host.querySelector('[data-pr-count]');
  if(n)n.textContent=Object.values(db.notes).filter(filled).length;
  const removeButton=host.querySelector('[data-pr="delete"]');
  if(removeButton)removeButton.hidden=!filled(note());
 }
 function download(ext,content,type){const a=document.createElement('a'),url=URL.createObjectURL((content instanceof Blob ? content : new Blob([content],{type})));a.href=url;a.download=project+'-评审意见.'+ext;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function exportNotes(ext){
  await waitForUploads();
  const fresh=await call('all');
  if(fresh.persistent)db=fresh.db;
  else warning=fresh.message;
  const notes=Object.values(db.notes).filter(filled).sort((a,b)=>a.id.localeCompare(b.id));
  try {
   if(ext==='package'){
    if(!notes.length){statusText('填写意见或添加图片后即可导出。');return;}
    const packed=await Promise.all(notes.map(async n=>({
     ...n,images:await ReviewImages.embed(n.images,images),processingProgress:progress(n),
     processingMessage:receiptFor(n)?.message,processedAt:receiptFor(n)?.processedAt,
    })));
    download('zip',ReviewPackage.build(packed,project),'application/zip');
    statusText('已导出带图评审包。'+(warning?' '+warning:''));
   }else if(ext==='json'){
    const packed=await Promise.all(notes.map(async n=>[n.id,{
     ...n,images:n.images?.length?await ReviewImages.embed(n.images,images):[],
     processingProgress:progress(n),processingMessage:receiptFor(n)?.message??'',
    }]));
    download(ext,JSON.stringify({schema:1,project,exportedAt:new Date().toISOString(),notes:Object.fromEntries(packed)},null,2),'application/json;charset=utf-8');
   }else download(ext,'# 设计评审意见\n\n项目：'+project+'\n仅包含人工填写的意见及页面位置。\n\n'+notes.filter(n=>n.text.trim()).map(n=>'## '+n.title+'\n\n页面：'+n.id+'\n场景：'+n.context+'\n状态：'+progress(n)+(progress(n)!==n.status?'\n本地标记：'+n.status:'')+(receiptFor(n)?'\n修改说明：'+receiptFor(n).message+'\n落实日期：'+receiptFor(n).processedAt:'')+'\n修改时间：'+n.updatedAt+'\n\n'+n.text).join('\n\n'),'text/markdown;charset=utf-8');
  }catch(error){statusText('导出失败：'+error.message);}
 }
 async function remove(id){if(!confirm('删除这条页面意见？删除前可先导出备份。'))return;const r=await call('delete',db.notes[id]);db=r.db;warning=r.message;draw();}
 function draw(){if(!host?.isConnected||!context)return;const n=note();host.className='page-review';host.innerHTML=`<div class="pr-heading"><div><strong>本页意见</strong><span class="pr-page">${esc(context.title)}</span></div><span class="pr-count">已记录 <b data-pr-count>0</b> 条</span></div><p class="pr-help">文字和图片会随当前场景保存在浏览器。分享时请导出带图评审包。</p><p class="pr-progress" data-pr-progress>${progressHTML(n)}</p><label class="pr-label">评审意见<textarea data-pr-text maxlength="20000" placeholder="例如：这里应先选择门店；失败后保留已填内容。" ${ready?'':'disabled'}>${esc(n.text)}</textarea></label><div data-pr-images></div><div class="pr-actions"><label>你的标记 <select data-pr-select ${ready?'':'disabled'}>${['待讨论','已确认修改','已处理'].map(s=>`<option ${s===n.status?'selected':''}>${s}</option>`).join('')}</select></label><button type="button" data-pr="save" ${ready?'':'disabled'}>保存本页意见</button><button type="button" data-pr="all">${showAll?'收起全部意见':'查看全部意见'}</button>${window.ReviewPackage?'<button type="button" data-pr="package">下载带图评审包</button>':''}<button type="button" data-pr="md">${window.ReviewPackage?'仅导出文字':'导出全部意见'}</button><button type="button" data-pr="json">备份 JSON</button><label class="pr-import">导入备份<input type="file" accept=".json,application/json" data-pr-file></label><button type="button" data-pr="delete" ${filled(n)?'':'hidden'}>删除本页意见</button></div>${window.ReviewPackage?'<p class="image-export-help">发给智能体时，解压 ZIP，把 review.md 和 images 一起提供。图片按意见和图号对应。</p>':''}<p data-pr-status role="status" class="${warning?'pr-warning':''}">${esc(warning||(!ready?'正在读取本地意见…':n.updatedAt?'已自动保存到当前浏览器':'填写后自动保存'))}</p>${showAll?`<div class="pr-all">${Object.values(db.notes).filter(filled).map(n=>`<article><strong>${esc(n.title)}</strong><small>${esc(progress(n))} · ${esc(n.context)}</small><p>${esc(n.text)}</p>${n.images?.length?`<small>${n.images.length} 张图</small>` : ''}</article>`).join('')||'<p>还没有评审意见。</p>'}</div>`:''}`;
 const target={...context};
 const attachmentHost=host.querySelector('[data-pr-images]');
 const changeImages=async fields=>{
   const current=note(target);
   await save(current.text,current.status,fields,target);
   if(target.id===context.id){
    const currentHost=host.querySelector('[data-pr-images]');
    if(currentHost!==attachmentHost)ReviewImages.refresh(currentHost);
   }
 };
 if(ready)window.ReviewImages?.mount(attachmentHost,{
   store:images,uploads,
   getImages:()=>note(target).images||[],
   addImages:incoming=>changeImages(ReviewImages.append(note(target),incoming)),
   removeImage:id=>changeImages({images:note(target).images.filter(image=>image.id!==id)}),
   setCaption:(id,caption)=>changeImages({images:note(target).images.map(image=>image.id===id?{...image,caption}:image)}),
   textField:host.querySelector('[data-pr-text]'),
 });
 counts();host.querySelector('[data-pr-text]').addEventListener('input',ev=>save(ev.target.value,host.querySelector('[data-pr-select]').value));host.querySelector('[data-pr-select]').addEventListener('change',ev=>save(host.querySelector('[data-pr-text]').value,ev.target.value));
 host.querySelectorAll('[data-pr]').forEach(b=>b.addEventListener('click',()=>{const a=b.dataset.pr;if(a==='save')save(host.querySelector('[data-pr-text]').value,host.querySelector('[data-pr-select]').value);if(a==='all'){call('all').then(r=>{db=r.db;warning=r.message;showAll=!showAll;draw()})}if(['md','json','package'].includes(a))exportNotes(a);if(a==='delete')remove(context.id)}));
 host.querySelector('[data-pr-file]').addEventListener('change',async ev=>{
  const input=ev.target;
  const file=input.files[0];
  if(!file)return;
  input.value='';
  try{
   const backup=JSON.parse(await file.text());
   if(backup.schema!==1||backup.project!==project||!backup.notes||Array.isArray(backup.notes))throw Error('备份格式或项目不匹配');
   const records=Object.values(backup.notes);
   if(!records.every(n=>valid(n,true)&&n.project===project))throw Error('备份内容不完整');
   if(!confirm('合并 '+records.length+' 条意见？相同页面只保留修改时间较新的内容，不清空其他意见。'))return;
   for(const note of records){
    const embedded=note.images||[];
    const prepared=await Promise.all(embedded.map(img=>ReviewImages.stash(img,images,{newId:true})));
    const result=await call('merge',{...note,images:prepared});
    db=result.db;
    warning=result.message;
   }
   draw();
   statusText(warning||'备份已合并');
  }catch(error){statusText('导入失败：'+error.message+'。现有意见未清空。');}
 });
 onResize();}
 return {mount(element,ctx){host=element;context=ctx;draw()},async refresh(ctx){await loading;if(ctx)context=ctx;const current=version,id=context?.id;const r=await call('all');if(current===version&&id===context?.id){db=r.db;warning=r.message;draw()}},exportNotes,ready:loading,data:()=>db,pending:()=>pending};
}
function attachDrawer({project,context:initialContext}){
 let current=initialContext,opened=false,returnFocus=null;
 const launcher=document.createElement('button');launcher.type='button';launcher.className='pr-launcher';launcher.setAttribute('aria-controls','pr-review-drawer');launcher.setAttribute('aria-expanded','false');launcher.innerHTML='<strong>本页意见</strong><span data-pr-current></span>';
 const drawer=document.createElement('section');drawer.id='pr-review-drawer';drawer.className='pr-drawer';drawer.hidden=true;drawer.setAttribute('role','region');drawer.setAttribute('aria-label','评审意见面板');drawer.innerHTML='<header class="pr-drawer-header"><div><strong>评审意见</strong><p>直接填写当前页面的意见，无需滚动正文</p></div><button type="button" data-pr-close aria-label="收起评审意见">收起 ×</button></header><div class="pr-drawer-body"><div data-pr-editor></div></div>';
 document.body.append(launcher,drawer);const reviewer=create({project}),editor=drawer.querySelector('[data-pr-editor]');
 function label(){launcher.querySelector('[data-pr-current]').textContent=current?.title||'当前页面'}
 async function open(ctx){if(ctx)current=ctx;if(!current)return;returnFocus=document.activeElement;opened=true;drawer.hidden=false;launcher.setAttribute('aria-expanded','true');label();reviewer.mount(editor,current);await reviewer.refresh(current);if(opened)editor.querySelector('textarea')?.focus({preventScroll:true})}
 function close(){opened=false;drawer.hidden=true;launcher.setAttribute('aria-expanded','false');if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true})}
 function setContext(ctx){if(!ctx)return;const changed=current?.id!==ctx.id||current?.description!==ctx.description;current=ctx;label();if(opened&&changed){reviewer.mount(editor,current);reviewer.refresh(current)}}
 launcher.addEventListener('click',()=>opened?close():open());drawer.querySelector('[data-pr-close]').addEventListener('click',close);
 document.addEventListener('keydown',ev=>{if(opened&&ev.key==='Escape'){ev.preventDefault();ev.stopImmediatePropagation();close()}},true);label();
 return {open,close,setContext,reviewer,isOpen:()=>opened};
}
window.PageReview={create,broker,attachDrawer,configure};
})();

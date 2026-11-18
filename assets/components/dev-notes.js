(() => {
  'use strict';

  function create({project, fileName = project, legacyStorageKey, resolveLegacyAnchor} = {}) {
    if (!project) throw new Error('DevNotes.create requires a stable project ID.');

    const dataElement = document.getElementById('dn-data');
    if (!dataElement) throw new Error('DevNotes requires the dn-data JSON script.');
    const exportData = JSON.parse(dataElement.textContent);
    const readOnly = exportData?.kind==='read';
    const handoff = exportData?.kind==='editable' ? exportData : null;
    const exportSource = readOnly ? '' : '<!doctype html>\n' + document.documentElement.outerHTML;
    const baseStorageKey = 'design-dev-notes:'+project+':1';
    const storageKey = handoff ? baseStorageKey+':handoff:'+handoff.id : baseStorageKey;
    const notesState = {notes:exportData?.notes ?? [], nextId:exportData?.nextId ?? 1};
    let lastStored;
    let warning = '';
    if (!readOnly) {
      try {
        lastStored = localStorage.getItem(storageKey);
        const older = !handoff && legacyStorageKey && lastStored === null
          ? localStorage.getItem(legacyStorageKey) : null;
        const raw = lastStored ?? older;
        if (raw !== null) {
          const saved = JSON.parse(raw);
          if (!Array.isArray(saved?.notes) || !Number.isSafeInteger(saved.nextId)) throw new Error('Invalid notes');
          Object.assign(notesState, saved);
        }
      } catch {
        lastStored = undefined;
        warning = '无法读取浏览器草稿。本次编辑暂留在此页，可导出备份。';
      }
    }
    const clamp = value => Math.max(0,Math.min(1,value));
    notesState.notes = notesState.notes.map(({id,page,target,label,title,text,point})=>({
      id,page,target,text:String(text ?? ''),title:String(title ?? label ?? ''),
      point:Number.isFinite(point?.x) && Number.isFinite(point?.y) ? {x:clamp(point.x),y:clamp(point.y)} : undefined,
    }));
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const filled = note => Boolean(note.title.trim() || note.text.trim());
    const currentNotes = () => notesState.notes.filter(note=>note.page===scene?.page && (!readOnly || filled(note)));
    const number = note => String(currentNotes().indexOf(note)+1).padStart(2,'0');
    const byId = id => currentNotes().find(note=>note.id===id);
    function defaultTitle(note) {
      const firstLine = Array.from(note.text.trim().split('\n',1)[0].trim());
      return firstLine.length>24 ? firstLine.slice(0,24).join('')+'…' : firstLine.join('') || '空白草稿';
    }
    const titleOf = note => note.title.trim() || defaultTitle(note);
    const markerLabel = note => number(note)+' '+titleOf(note);

    const drawer = document.createElement('aside');
    drawer.id = 'dn-drawer';
    drawer.setAttribute('aria-labelledby','dn-heading');
    drawer.hidden = true;
    const layer = document.createElement('div');
    layer.className = 'dn-point-layer';
    let stage, scene, toggle, listButton, placementHint, controls, activeId;
    let enabled = false;
    let panelOpen = false;
    let picking = false;
    let pinDrag, suppressPinClick;
    let drawerPosition, drawerDrag;
    let selectedNoteIds = null;
    let draggedNoteId;

    function moveDrawer(x, y) {
      const viewport = document.documentElement;
      drawerPosition = {
        x:Math.max(0,Math.min(x,viewport.clientWidth - drawer.offsetWidth)),
        y:Math.max(0,Math.min(y,viewport.clientHeight - drawer.offsetHeight)),
      };
      drawer.style.left = drawerPosition.x+'px';
      drawer.style.top = drawerPosition.y+'px';
      drawer.classList.add('dn-moved');
    }

    function keepDrawerInView() {
      if (drawerPosition && !drawer.hidden) moveDrawer(drawerPosition.x,drawerPosition.y);
    }

    function resizeDrawer(bounds, edge, dx, dy) {
      const viewport = document.documentElement;
      const fromLeft = edge==='left';
      const maxWidth = fromLeft ? bounds.right : viewport.clientWidth - bounds.left;
      const maxHeight = viewport.clientHeight - bounds.top;
      const width = Math.min(maxWidth,Math.max(300,bounds.width+(fromLeft ? -dx : dx)));
      const height = Math.min(maxHeight,Math.max(260,bounds.height+dy));
      drawer.style.setProperty('--dn-custom-width',width+'px');
      drawer.style.setProperty('--dn-custom-height',height+'px');
      drawer.classList.add('dn-resized');
      moveDrawer(fromLeft ? bounds.right-drawer.offsetWidth : bounds.left,bounds.top);
    }

    drawer.addEventListener('pointerdown',event=>{
      if (!event.isPrimary || event.button!==0 || event.target.closest('button')) return;
      const edge = event.target.closest('[data-dn-resize]')?.dataset.dnResize;
      if (!edge && !event.target.closest('.dn-head')) return;
      const bounds = drawer.getBoundingClientRect();
      drawerDrag = {id:event.pointerId,bounds,edge,x:event.clientX,y:event.clientY};
      drawer.setPointerCapture(event.pointerId);
      if (!edge) drawer.classList.add('dn-dragging');
      event.preventDefault();
    });
    drawer.addEventListener('pointermove',event=>{
      if (event.pointerId!==drawerDrag?.id) return;
      const {bounds,edge,x,y} = drawerDrag;
      const dx = event.clientX-x;
      const dy = event.clientY-y;
      if (edge) resizeDrawer(bounds,edge,dx,dy);
      else moveDrawer(bounds.left+dx,bounds.top+dy);
    });
    drawer.addEventListener('lostpointercapture',()=>{
      drawerDrag = undefined;
      drawer.classList.remove('dn-dragging');
    });
    window.addEventListener('resize',keepDrawerInView);
    new ResizeObserver(keepDrawerInView).observe(drawer);

    function persist() {
      if (lastStored === undefined) return false;
      try {
        if (localStorage.getItem(storageKey) !== lastStored) {
          warning = '另一页面已更新这份草稿。此处改动暂留在当前页，可导出备份。';
          return false;
        }
        const value = JSON.stringify(notesState);
        localStorage.setItem(storageKey,value);
        lastStored = value;
        warning = '';
        return true;
      } catch {
        warning = '本地保存失败。此处改动暂留在当前页，请先导出备份。';
        return false;
      }
    }

    function updateToggle() {
      if (!toggle) return;
      toggle.textContent = enabled ? (picking ? '取消落点' : '关闭研发说明') : '研发说明 ('+currentNotes().filter(filled).length+')';
      toggle.setAttribute('aria-pressed',String(enabled));
      toggle.toggleAttribute('data-picking',picking);
      listButton.hidden = !enabled || panelOpen || picking;
      placementHint.hidden = !picking;
      stage.classList.toggle('dn-point-picking',picking);
    }

    function stageGeometry() {
      const box = stage.getBoundingClientRect();
      return {
        left:box.left+stage.clientLeft,
        top:box.top+stage.clientTop,
        width:stage.scrollWidth,
        height:stage.scrollHeight,
      };
    }

    function pointAt(x,y) {
      const box = stageGeometry();
      return {
        x:clamp((x-box.left+stage.scrollLeft)/box.width),
        y:clamp((y-box.top+stage.scrollTop)/box.height),
      };
    }

    const fallbackPoint = index => ({x:.07+.045*(index%5),y:.09+.035*(Math.floor(index/5)%12)});

    function migrateLegacyPins() {
      const legacy = currentNotes().filter(note=>note.target || !note.point);
      if (!legacy.length) return;
      let changed = false;
      for (const [index,note] of legacy.entries()) {
        const anchor = note.target && resolveLegacyAnchor?.(note.target, stage, scene.page);
        if (anchor?.getClientRects().length) {
          const box = anchor.getBoundingClientRect();
          note.point = pointAt(box.right-Math.min(12,box.width/2),box.top+Math.min(12,box.height/2));
          delete note.target;
          changed = true;
        } else if (note.target==='page:overview' || !note.point) {
          note.point = fallbackPoint(index);
          // A control missing from the current scene can still resolve when another scene opens.
          if (note.target==='page:overview') delete note.target;
          changed = true;
        }
      }
      if (changed && !readOnly && !persist() && !drawer.hidden) showSaveResult(false);
    }

    function pinPosition(point) {
      const {width,height} = stageGeometry();
      return {
        x:Math.max(16,Math.min(width-16,point.x*width))-stage.scrollLeft,
        y:Math.max(12,Math.min(height-12,point.y*height))-stage.scrollTop,
      };
    }

    function placePin(pin,point) {
      const {x,y} = pinPosition(point);
      pin.style.left = x+'px';
      pin.style.top = y+'px';
    }

    function drawMarkers() {
      layer.replaceChildren();
      if (!scene || !enabled || picking) return;
      const stageBox = stageGeometry();
      const parent = layer.parentElement;
      const host = parent.getBoundingClientRect();
      const left = stageBox.left - host.left - parent.clientLeft + parent.scrollLeft;
      const top = stageBox.top - host.top - parent.clientTop + parent.scrollTop;
      layer.style.cssText = `left:${left}px;top:${top}px;width:${stage.clientWidth}px;height:${stage.clientHeight}px`;
      for (const note of currentNotes()) {
        if (!note.point) continue;
        const pin = document.createElement('span');
        pin.className = 'dn-point-pin';
        placePin(pin,note.point);
        pin.hidden = parseFloat(pin.style.left)<0 || parseFloat(pin.style.left)>stage.clientWidth
          || parseFloat(pin.style.top)<0 || parseFloat(pin.style.top)>stage.clientHeight;
        pin.innerHTML = `<button type="button" class="dn-mark${readOnly?'':' dn-movable'}" data-dn-command="open"
          data-dn-value="${note.id}" aria-label="${esc(markerLabel(note))}" title="${esc(titleOf(note))}">${number(note)}</button>`;
        layer.append(pin);
      }
    }

    let markerFrame;
    function scheduleMarkers() {
      if (!enabled || !scene || markerFrame || pinDrag) return;
      markerFrame = requestAnimationFrame(()=>{
        markerFrame = undefined;
        if (enabled && scene && !pinDrag) drawMarkers();
      });
    }
    const stageObserver = new ResizeObserver(scheduleMarkers);
    window.addEventListener('scroll',scheduleMarkers,true);
    window.addEventListener('resize',scheduleMarkers);
    document.addEventListener('toggle',event=>{
      if (!stage?.contains(event.target)) return;
      migrateLegacyPins();
      scheduleMarkers();
    },true);

    function drawNoteList(items) {
      const canSort = !readOnly && !selectedNoteIds && items.length>1;
      const intro = selectedNoteIds ? '勾选要删除的说明，可全选当前页。'
        : readOnly ? '点页面上的编号，或从下方选择一条说明。'
        : '点击画布上的编号查看说明，拖动编号可移动位置。'+(canSort ? '按住列表整行可拖动排序。' : '');
      const rows = items.map(item=>{
        const title = esc(titleOf(item));
        const label = `<span class="dn-number">${number(item)}</span><span><strong>${title}</strong></span>`;
        if (selectedNoteIds) return `<li><label class="dn-note-option"><input type="checkbox" data-dn-note-id="${item.id}">${label}</label></li>`;
        return `<li class="dn-note-row" data-dn-order-id="${item.id}"${canSort?' draggable="true"':''}>
          <button type="button" data-dn-command="open" data-dn-value="${item.id}"${canSort?' aria-keyshortcuts="ArrowUp ArrowDown"':''}>
            ${label}${canSort?'<span class="dn-sort-grip" aria-hidden="true"></span>':''}
          </button>
        </li>`;
      }).join('');
      return `
        <p class="dn-intro">${intro}</p>
        ${readOnly ? '' : selectedNoteIds ? `
          <div class="dn-list-actions">
            <label class="dn-select-all"><input type="checkbox" id="dn-select-all">全选当前页</label>
            <button type="button" class="dn-button dn-danger" data-dn-command="bulk-remove" disabled>删除所选 (0)</button>
            <button type="button" class="dn-button" data-dn-command="bulk-cancel">取消多选</button>
          </div>` : `
          <div class="dn-list-actions">
            <button type="button" class="dn-button dn-primary" data-dn-command="start">＋ 新增说明</button>
            ${items.length?'<button type="button" class="dn-button" data-dn-command="bulk-start">批量删除</button>':''}
          </div>`}
        <p class="dn-list-feedback" role="status"></p>
        <ul class="dn-list">${rows}</ul>
        ${items.length?'':'<p class="dn-meta">本页还没有说明。</p>'}
      `;
    }

    function updateSelectionControls() {
      const checkboxes = drawer.querySelectorAll('[data-dn-note-id]');
      for (const checkbox of checkboxes) checkbox.checked = selectedNoteIds.has(Number(checkbox.dataset.dnNoteId));
      const count = selectedNoteIds.size;
      const all = drawer.querySelector('#dn-select-all');
      all.checked = count>0 && count===checkboxes.length;
      all.indeterminate = count>0 && !all.checked;
      const remove = drawer.querySelector('[data-dn-command="bulk-remove"]');
      remove.disabled = count===0;
      remove.textContent = '删除所选 ('+count+')';
    }

    function drawDrawer(focus = false) {
      drawer.hidden = !enabled || !scene || picking || !panelOpen;
      if (drawer.hidden) return;
      const note = byId(activeId);
      const items = currentNotes();
      const content = note ? `
        <div class="dn-list-actions">
          <button type="button" class="dn-button" data-dn-command="list">‹ 返回说明列表</button>
          ${readOnly?'':'<button type="button" class="dn-button dn-danger" data-dn-command="remove">删除这条说明</button>'}
        </div>
        <h3><span>${number(note)}</span> <strong id="dn-note-title">${esc(titleOf(note))}</strong></h3>
        ${readOnly ? `<p class="dn-copy">${esc(note.text)}</p>` : `
          <label class="dn-title-field">标题 <small>留空时使用正文首行</small>
            <input id="dn-title" type="text" maxlength="60" value="${esc(note.title)}" placeholder="选填">
          </label>
          <label class="dn-field">给研发的说明
            <textarea id="dn-text" rows="12" maxlength="6000" placeholder="例如：字段如何取值，按钮何时可用，失败时如何处理。">${esc(note.text)}</textarea>
          </label>
          <div class="dn-editor-actions">
            <button type="button" class="dn-button dn-primary" data-dn-command="save-continue">保存并继续添加</button>
            <p class="dn-save" aria-live="polite" role="status">${warning?'':filled(note)?'草稿保存在当前浏览器。':'输入后自动保存。'}</p>
          </div>`}
      ` : drawNoteList(items);
      drawer.innerHTML = `
        <header class="dn-head" title="拖动标题栏移动浮窗">
          <div class="dn-head-title">
            <svg width="12" height="18" viewBox="0 0 12 18" fill="currentColor" aria-hidden="true">
              <circle cx="3" cy="3" r="1.5"/><circle cx="9" cy="3" r="1.5"/>
              <circle cx="3" cy="9" r="1.5"/><circle cx="9" cy="9" r="1.5"/>
              <circle cx="3" cy="15" r="1.5"/><circle cx="9" cy="15" r="1.5"/>
            </svg>
            <div><p>${esc(scene.title)} · ${readOnly?'只读查看版':handoff?'可编辑交接版':'低保真'}</p><h2 id="dn-heading" tabindex="-1">研发说明</h2></div>
          </div>
          <button type="button" class="dn-close" data-dn-command="collapse" aria-label="收起说明抽屉" title="收起说明抽屉">×</button>
        </header>
        <div class="dn-body${note&&!readOnly?' dn-editor':''}">${content}
          <p id="dn-warning" role="alert" ${warning?'':'hidden'}>${esc(warning)}</p>
        </div>
        ${!readOnly ? `<footer class="dn-footer">
          <div class="dn-export-actions">
            <button type="button" class="dn-button" data-dn-command="export" data-dn-value="read">导出带说明的 HTML</button>
            <button type="button" class="dn-button" data-dn-command="export" data-dn-value="editable">导出可编辑 HTML</button>
          </div>
          <small aria-live="polite" id="dn-export-message">查看版供阅读，可编辑版包含说明和草稿，可交给同事继续修改。</small>
        </footer>` : ''}
        <span class="dn-resize dn-resize-left" data-dn-resize="left" title="向左拖宽，向下拖高" aria-hidden="true"></span>
        <span class="dn-resize dn-resize-right" data-dn-resize="right" title="拖动调整宽度和高度" aria-hidden="true"></span>
      `;
      if (selectedNoteIds && !note) updateSelectionControls();
      keepDrawerInView();
      if (focus) (drawer.querySelector('#dn-text') || drawer.querySelector('#dn-heading')).focus({preventScroll:true});
    }

    function showSaveResult(saved) {
      const message = drawer.querySelector('.dn-save');
      if (message) message.textContent = saved ? '已自动保存到当前浏览器。' : '';
      const alert = drawer.querySelector('#dn-warning');
      alert.textContent = warning;
      alert.hidden = !warning;
    }

    function sync(focus = false) {
      updateToggle();
      drawMarkers();
      drawDrawer(focus);
    }

    function startPlacement() {
      picking = true;
      sync();
      toggle.focus({preventScroll:true});
    }

    function removeNotes(items, bulk = false) {
      if (readOnly || !items.length) return;
      const message = bulk ? '删除选中的 '+items.length+' 条研发说明？' : '删除这条研发说明？';
      if (!confirm(message)) return;
      const previous = notesState.notes;
      const ids = new Set(items.map(item=>item.id));
      notesState.notes = previous.filter(item=>!ids.has(item.id));
      if (!persist()) {
        notesState.notes = previous;
        warning = '删除未保存，所选说明已保留。请检查浏览器存储后重试。';
        showSaveResult(false);
        return;
      }
      activeId = undefined;
      selectedNoteIds = null;
      sync(true);
      drawer.querySelector('.dn-list-feedback').textContent = '已删除 '+items.length+' 条说明。';
    }

    function addPoint(point) {
      const note = {id:notesState.nextId++,page:scene.page,title:'',text:'',point};
      notesState.notes.push(note);
      activeId = note.id;
      persist();
      picking = false;
      sync(true);
    }

    function download(kind) {
      const editable = kind==='editable';
      const notes = notesState.notes.filter(filled);
      const message = drawer.querySelector('#dn-export-message');
      if (!editable && !notes.length) {
        message.textContent = '填写至少一条说明后即可导出。';
        return;
      }
      const pageIndexes = new Map();
      const exportedNotes = (editable?notesState.notes:notes).map(note=>{
        const index = pageIndexes.get(note.page) || 0;
        pageIndexes.set(note.page,index+1);
        return note.point?note:{...note,point:fallbackPoint(index)};
      });
      const payload = {
        kind:editable?'editable':'read',
        id:Array.from(crypto.getRandomValues(new Uint32Array(4)),value=>value.toString(16)).join('-'),
        view:scene.view,
        notes:exportedNotes,
        nextId:notesState.nextId,
      };
      const data = JSON.stringify(payload).replace(/</g,'\\u003c');
      const html = exportSource.replace(/(<script id="dn-data" type="application\/json">)[^<]*(<\/script>)/,(_,start,end)=>start+data+end);
      const url = URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = editable ? fileName+'-研发说明-可编辑.html' : fileName+'-研发说明.html';
      link.click();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      message.textContent = editable ? '已生成可编辑 HTML，可将文件交给同事继续编辑。' : '已生成含 '+notes.length+' 条说明的 HTML。';
    }

    function close() {
      enabled = false;
      panelOpen = false;
      picking = false;
      activeId = undefined;
      selectedNoteIds = null;
      sync();
      toggle?.focus({preventScroll:true});
    }

    function collapse() {
      panelOpen = false;
      activeId = undefined;
      selectedNoteIds = null;
      sync();
      listButton?.focus({preventScroll:true});
    }

    document.addEventListener('click', event=>{
      const command = event.target.closest('[data-dn-command]');
      if (!command) {
        if (!picking || !stage?.contains(event.target)) return;
        event.stopImmediatePropagation();
        event.preventDefault();
        if (event.detail>0) addPoint(pointAt(event.clientX,event.clientY));
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (command===suppressPinClick && event.detail>0) {
        suppressPinClick = undefined;
        return;
      }
      const {dnCommand: name, dnValue: value} = command.dataset;
      if (name==='toggle') {
        if (picking) {picking = false; sync(true);}
        else if (enabled) close();
        else {enabled = true; panelOpen = true; sync(true);}
      }
      if (name==='collapse') collapse();
      if (name==='show') {panelOpen = true; sync(true);}
      if (name==='start') startPlacement();
      if (name==='save-continue' && byId(activeId)) {
        if (persist()) startPlacement();
        else {
          showSaveResult(false);
          drawer.querySelector('#dn-warning').scrollIntoView({block:'nearest'});
        }
      }
      if (name==='open') {panelOpen = true; activeId = Number(value); selectedNoteIds = null; sync(true);}
      if (name==='list') {activeId = undefined; sync(true);}
      if (name==='export') download(value);
      if (name==='remove') removeNotes(currentNotes().filter(note=>note.id===activeId));
      if (name==='bulk-start') {
        selectedNoteIds = new Set();
        drawDrawer();
        drawer.querySelector('#dn-select-all').focus({preventScroll:true});
      }
      if (name==='bulk-cancel') {
        selectedNoteIds = null;
        drawDrawer();
        drawer.querySelector('[data-dn-command="bulk-start"]').focus({preventScroll:true});
      }
      if (name==='bulk-remove' && selectedNoteIds) removeNotes(currentNotes().filter(note=>selectedNoteIds.has(note.id)),true);
    },true);

    drawer.addEventListener('change',event=>{
      if (!selectedNoteIds) return;
      const checkbox = event.target;
      if (checkbox.id==='dn-select-all') {
        selectedNoteIds = new Set(checkbox.checked ? currentNotes().map(note=>note.id) : []);
      } else if (checkbox.hasAttribute('data-dn-note-id')) {
        const id = Number(checkbox.dataset.dnNoteId);
        if (checkbox.checked) selectedNoteIds.add(id);
        else selectedNoteIds.delete(id);
      } else return;
      updateSelectionControls();
    });

    drawer.addEventListener('input',event=>{
      const note = byId(activeId);
      if (!note || readOnly) return;
      if (event.target.id==='dn-title') note.title = event.target.value;
      else if (event.target.id==='dn-text') note.text = event.target.value;
      else return;
      drawer.querySelector('#dn-note-title').textContent = titleOf(note);
      const button = layer.querySelector('.dn-mark[data-dn-value="'+note.id+'"]');
      button?.setAttribute('aria-label',markerLabel(note));
      if (button) button.title = titleOf(note);
      showSaveResult(persist());
    });

    document.addEventListener('pointerdown',event=>{
      if (readOnly || picking || !event.isPrimary || event.button!==0) return;
      suppressPinClick = undefined;
      const button = event.target.closest('.dn-mark.dn-movable');
      if (!button || !layer.contains(button)) return;
      const note = byId(Number(button.dataset.dnValue));
      if (!note) return;
      const pin = button.closest('.dn-point-pin');
      const box = pin.getBoundingClientRect();
      pinDrag = {
        id:event.pointerId, button, pin, note, x:event.clientX, y:event.clientY,
        centerX:box.left+box.width/2, centerY:box.top+box.height/2,
      };
      button.setPointerCapture(event.pointerId);
    });

    document.addEventListener('pointermove',event=>{
      if (pinDrag?.id!==event.pointerId || !pinDrag.pin.isConnected) return;
      const dx = event.clientX-pinDrag.x;
      const dy = event.clientY-pinDrag.y;
      if (!pinDrag.point && Math.hypot(dx,dy)<5) return;
      pinDrag.point = pointAt(pinDrag.centerX+dx,pinDrag.centerY+dy);
      pinDrag.pin.classList.add('dn-pin-moving');
      placePin(pinDrag.pin,pinDrag.point);
    });

    function endPinDrag(event) {
      if (pinDrag?.id!==event.pointerId) return;
      const {button,pin,note,point} = pinDrag;
      pinDrag = undefined;
      pin.classList.remove('dn-pin-moving');
      if (!point || !pin.isConnected) return;
      if (event.type!=='pointerup') {
        placePin(pin,note.point);
        return;
      }
      suppressPinClick = button;
      const previous = note.point;
      const legacyTarget = note.target;
      note.point = point;
      delete note.target;
      if (persist()) {
        if (!drawer.hidden) showSaveResult(true);
        return;
      }
      note.point = previous;
      if (legacyTarget) note.target = legacyTarget;
      placePin(pin,previous);
      warning = '位置未保存，编号已恢复原位置。';
      if (drawer.hidden) {
        panelOpen = true;
        sync();
      } else showSaveResult(false);
    }
    document.addEventListener('pointerup',endPinDrag);
    document.addEventListener('pointercancel',endPinDrag);
    document.addEventListener('lostpointercapture',endPinDrag);

    function reorderNote(id, targetId, after) {
      const items = currentNotes();
      const from = items.findIndex(note=>note.id===id);
      const target = items.findIndex(note=>note.id===targetId);
      if (from<0 || target<0 || from===target) return;
      const position = target + Number(after) - Number(from<target);
      if (from===position) return;
      const [note] = items.splice(from,1);
      items.splice(position,0,note);
      const ids = new Set(items.map(item=>item.id));
      const previous = notesState.notes;
      let index = 0;
      notesState.notes = previous.map(item=>ids.has(item.id)?items[index++]:item);
      if (!persist()) {
        notesState.notes = previous;
        warning = '排序未保存，原顺序已保留。请检查浏览器存储后重试。';
        showSaveResult(false);
        return;
      }
      sync();
      drawer.querySelector('.dn-list-feedback').textContent = '已调整到第 '+(position+1)+' 条。';
      drawer.querySelector('[data-dn-order-id="'+id+'"] [data-dn-command="open"]')?.focus({preventScroll:true});
    }

    function clearDropTarget() {
      drawer.querySelector('.dn-drop-before,.dn-drop-after')?.classList.remove('dn-drop-before','dn-drop-after');
    }

    function endNoteDrag() {
      draggedNoteId = undefined;
      drawer.querySelector('.dn-sort-source')?.classList.remove('dn-sort-source');
      clearDropTarget();
    }

    function afterRow(event, row) {
      const {top,height} = row.getBoundingClientRect();
      return event.clientY>=top+height/2;
    }

    drawer.addEventListener('dragstart',event=>{
      const row = event.target.closest('.dn-note-row[draggable="true"]');
      if (!row) return;
      draggedNoteId = Number(row.dataset.dnOrderId);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain',String(draggedNoteId));
      row.classList.add('dn-sort-source');
    });
    drawer.addEventListener('dragover',event=>{
      if (draggedNoteId===undefined) return;
      const row = event.target.closest('[data-dn-order-id]');
      clearDropTarget();
      if (!row || Number(row.dataset.dnOrderId)===draggedNoteId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      row.classList.add(afterRow(event,row)?'dn-drop-after':'dn-drop-before');
    });
    drawer.addEventListener('dragleave',event=>{
      if (!drawer.contains(event.relatedTarget)) clearDropTarget();
    });
    drawer.addEventListener('drop',event=>{
      const row = event.target.closest('[data-dn-order-id]');
      if (draggedNoteId===undefined || !row) return;
      event.preventDefault();
      const id = draggedNoteId;
      endNoteDrag();
      reorderNote(id,Number(row.dataset.dnOrderId),afterRow(event,row));
    });
    drawer.addEventListener('dragend',endNoteDrag);
    drawer.addEventListener('keydown',event=>{
      if (!event.target.matches('[data-dn-command="open"]') || !['ArrowUp','ArrowDown'].includes(event.key)) return;
      const row = event.target.closest('.dn-note-row[draggable="true"]');
      if (!row) return;
      event.preventDefault();
      const down = event.key==='ArrowDown';
      const target = down ? row.nextElementSibling : row.previousElementSibling;
      if (target) reorderNote(Number(row.dataset.dnOrderId),Number(target.dataset.dnOrderId),down);
    });

    document.addEventListener('submit',event=>{
      if (picking && stage?.contains(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },true);

    document.addEventListener('keydown',event=>{
      if (event.key==='Escape' && scene && (picking || drawer.contains(event.target))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (picking) {picking = false; sync(true);}
        else collapse();
        return;
      }
      if (picking && event.key!=='Tab' && stage?.contains(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },true);

    return {
      initialView:exportData?.view,
      mount({pageId, title, stage: currentStage, controls: currentControls, view} = {}) {
        const nextScene = currentStage && currentControls && pageId ? {page:pageId,title,view} : null;
        const changed = nextScene?.page!==scene?.page;
        const stageChanged = currentStage!==stage;
        if (stageChanged) {
          stage?.classList.remove('dn-point-picking');
          pinDrag = undefined;
          suppressPinClick = undefined;
        }
        if (currentControls!==controls) controls?.querySelector('.dn-tools')?.remove();
        scene = nextScene;
        stage = currentStage;
        controls = currentControls;
        if (changed) {
          picking = false;
          activeId = undefined;
          selectedNoteIds = null;
          endNoteDrag();
        }
        stageObserver.disconnect();
        if (!scene) {
          drawer.hidden = true;
          layer.remove();
          toggle = undefined;
          return;
        }
        if (!drawer.isConnected) document.body.append(drawer);
        if (stageChanged || !layer.isConnected) {
          stage.parentElement.classList.add('dn-stage-host');
          stage.parentElement.append(layer);
        }
        stageObserver.observe(stage);
        if (stage.firstElementChild) stageObserver.observe(stage.firstElementChild);
        toggle = controls.querySelector('.dn-toggle');
        if (!toggle) {
          const actions = document.createElement('div');
          actions.className = 'dn-tools';
          actions.innerHTML = `
            <button type="button" class="dn-button dn-toggle" data-dn-command="toggle" aria-controls="dn-drawer"></button>
            <button type="button" class="dn-button dn-list-button" data-dn-command="show" hidden>说明列表</button>
            <p class="dn-placement-hint" role="status" hidden>点击原型画布上的任意位置，放置说明编号。</p>`;
          controls.append(actions);
        }
        toggle = controls.querySelector('.dn-toggle');
        listButton = controls.querySelector('.dn-list-button');
        placementHint = controls.querySelector('.dn-placement-hint');
        migrateLegacyPins();
        if (changed) sync();
        else {
          updateToggle();
          drawMarkers();
        }
      },
    };
  }

  window.DevNotes = {create};
})();

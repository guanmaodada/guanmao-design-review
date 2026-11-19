(() => {
  const extensions = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
    'image/gif': 'gif', 'image/avif': 'avif', 'image/bmp': 'bmp',
  };

  function validData(data, type) {
    if (typeof data !== 'string') return false;
    const match = /^data:(image\/[a-z]+);base64,/.exec(data);
    return Boolean(match && Object.hasOwn(extensions, match[1]) && (!type || type === match[1]));
  }

  function valid(image, requireData = false) {
    return image && typeof image.id === 'string' && image.id.length > 0 && image.id.length <= 128
      && typeof image.name === 'string' && Number.isSafeInteger(image.number) && image.number > 0
      && typeof image.caption === 'string' && Object.hasOwn(extensions, image.type)
      && (image.data === undefined && !requireData || validData(image.data, image.type));
  }

  const newId = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), part => part.toString(16).padStart(8, '0')).join('');
  let database;
  function openDatabase() {
    database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('guanmao-review-images', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('images');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(error => {
      database = null;
      throw error;
    });
    return database;
  }

  function store(scope) {
    async function operation(mode, apply) {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('images', mode);
        const request = apply(transaction.objectStore('images'));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error);
      });
    }
    return {
      get: id => operation('readonly', images => images.get([scope, id])),
      put: async (id, data) => {
        await operation('readwrite', images => images.put(data, [scope, id]));
        return true;
      },
      remove: id => operation('readwrite', images => images.delete([scope, id])),
    };
  }

  // Keep inline data if indexed storage is unavailable so the existing draft and export can still carry it.
  async function stash(image, storage, {newId: assignId = false} = {}) {
    const {data, ...metadata} = image;
    if (assignId) metadata.id = newId();
    try {
      if (await storage.put(metadata.id, data)) return metadata;
    } catch {}
    return {...metadata, data};
  }

  async function load(image, storage) {
    let data = image.data;
    if (!data) {
      try { data = await storage.get(image.id); } catch {}
    }
    if (!validData(data, image.type)) throw new Error('无法读取附件「' + image.name + '」，请检查浏览器存储或重新添加原图。');
    return data;
  }

  function embed(images, storage) {
    return Promise.all((images || []).map(async image => ({...image, data: await load(image, storage)})));
  }

  function readImage(file, name) {
    return new Promise((resolve, reject) => {
      if (!Object.hasOwn(extensions, file.type)) {
        reject(new Error('仅支持 PNG、JPG、WebP、GIF、AVIF 或 BMP 图片。'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('图片读取失败，请重新添加。'));
      reader.onload = async () => {
        const image = new Image();
        image.src = String(reader.result);
        try {
          await image.decode();
          resolve({id: newId(), name, caption: '', type: file.type, data: image.src});
        } catch {
          reject(new Error('图片无法打开，请重新添加。'));
        }
      };
      reader.readAsDataURL(file);
    });
  }

  let viewer;
  const mounted = new WeakMap();
  function preview(images, index, storage) {
    if (!viewer) {
      viewer = document.createElement('dialog');
      viewer.className = 'image-viewer';
      viewer.setAttribute('aria-labelledby', 'image-viewer-title');
      viewer.innerHTML = `
        <header class="image-viewer-bar">
          <div><strong id="image-viewer-title">图片预览</strong><span data-image-position></span></div>
          <div class="image-viewer-tools">
            <button type="button" data-image-size aria-pressed="false">原始大小</button>
            <button type="button" data-image-close autofocus aria-label="关闭图片预览">关闭 ×</button>
          </div>
        </header>
        <div class="image-viewer-stage" tabindex="0" aria-label="图片查看区域"><img alt=""><p role="status" data-viewer-status></p></div>
        <footer class="image-viewer-bar">
          <p data-image-caption></p>
          <div class="image-viewer-tools">
            <button type="button" data-image-prev aria-label="上一张">← 上一张</button>
            <button type="button" data-image-next aria-label="下一张">下一张 →</button>
          </div>
        </footer>`;
      document.body.append(viewer);
    }
    const title = viewer.querySelector('#image-viewer-title');
    const stage = viewer.querySelector('.image-viewer-stage');
    const picture = viewer.querySelector('img');
    const next = viewer.querySelector('[data-image-next]');
    const prev = viewer.querySelector('[data-image-prev]');
    const size = viewer.querySelector('[data-image-size]');
    const close = viewer.querySelector('[data-image-close]');

    let renderVersion = 0;
    function render() {
      const image = images[index];
      title.textContent = image.name;
      picture.alt = image.caption || image.name;
      picture.removeAttribute('src');
      picture.hidden = true;
      const status = viewer.querySelector('[data-viewer-status]');
      status.textContent = '正在读取原图…';
      const version = ++renderVersion;
      load(image, storage).then(data => {
        if (version !== renderVersion) return;
        picture.src = data;
        picture.hidden = false;
        status.textContent = '';
      }).catch(error => {
        if (version === renderVersion) status.textContent = error.message;
      });
      viewer.querySelector('[data-image-position]').textContent = `第 ${index + 1} 张 / 共 ${images.length} 张`;
      viewer.querySelector('[data-image-caption]').textContent = image.caption;
      next.disabled = index === images.length - 1;
      prev.disabled = index === 0;
      stage.scrollTo(0, 0);
    }

    function toggleSize(actual) {
      stage.classList.toggle('actual-size', actual);
      size.textContent = actual ? '适应窗口' : '原始大小';
      size.setAttribute('aria-pressed', String(actual));
    }

    next.onclick = () => { index++; render(); };
    prev.onclick = () => { index--; render(); };
    size.onclick = () => toggleSize(!stage.classList.contains('actual-size'));
    close.onclick = () => viewer.close();
    const navigation = event => {
      if (!viewer.open) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        viewer.close();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        if (event.key === 'ArrowLeft' && !prev.disabled) prev.click();
        if (event.key === 'ArrowRight' && !next.disabled) next.click();
      }
    };
    window.addEventListener('keydown', navigation, true);
    viewer.addEventListener('close', () => window.removeEventListener('keydown', navigation, true), {once: true});
    toggleSize(false);
    render();
    viewer.showModal();
  }

  function mount(host, {store: storage, uploads, getImages, addImages, removeImage, setCaption, textField, readOnly = false}) {
    host.className = 'image-attachments';
    host.innerHTML = `
      <div class="image-attachment-heading">
        <strong>图片附件 <span data-image-count></span></strong>
        ${readOnly ? '' : '<button class="image-upload" type="button">＋ 上传图片</button><input class="image-file" type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.avif,.bmp" aria-label="选择图片文件" multiple hidden>'}
      </div>
      ${readOnly ? '' : '<p class="image-help">可一次选多张，也可在输入框里按 <kbd>Ctrl</kbd> + <kbd>V</kbd>（Mac <kbd>⌘</kbd> + <kbd>V</kbd>）粘贴截图。</p>'}
      <div class="image-grid"></div>
      <p class="image-feedback" role="status"></p>`;
    const grid = host.querySelector('.image-grid');
    const feedback = host.querySelector('.image-feedback');

    function draw() {
      const images = getImages();
      host.querySelector('[data-image-count]').textContent = images.length ? `${images.length} 张` : '';
      grid.replaceChildren();
      for (const [index, image] of images.entries()) {
        const label = `图 ${image.number}`;
        const card = document.createElement('div');
        card.className = 'image-card';
        const thumbnail = document.createElement('button');
        thumbnail.type = 'button';
        thumbnail.className = 'image-thumbnail';
        thumbnail.setAttribute('aria-label', `预览${label}：${image.name}`);
        const picture = document.createElement('img');
        load(image, storage).then(data => { picture.src = data; }).catch(() => {
          thumbnail.classList.add('image-unavailable');
          thumbnail.title = '图片无法读取';
        });
        picture.alt = '';
        const badge = document.createElement('span');
        badge.textContent = label;
        thumbnail.append(picture, badge);
        thumbnail.addEventListener('click', () => preview(getImages(), index, storage));
        const name = document.createElement('p');
        name.className = 'image-name';
        name.title = image.name;
        name.textContent = image.name;
        card.append(thumbnail, name);
        if (readOnly) {
          if (image.caption) {
            const description = document.createElement('p');
            description.className = 'image-description';
            description.textContent = image.caption;
            card.append(description);
          }
        } else {
          const description = document.createElement('input');
          description.className = 'image-description';
          description.value = image.caption;
          description.maxLength = 240;
          description.placeholder = '图片说明（选填）';
          description.setAttribute('aria-label', label + '图片说明');
          description.addEventListener('input', () => setCaption(image.id, description.value));
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'image-remove';
          remove.textContent = '×';
          remove.setAttribute('aria-label', '移除' + label);
          remove.addEventListener('click', () => {
            removeImage(image.id);
            draw();
            (grid.querySelector('.image-thumbnail') || host.querySelector('.image-upload')).focus();
            feedback.textContent = '已移除图片。';
          });
          card.append(description, remove);
        }
        grid.append(card);
      }
    }

    mounted.set(host, draw);
    draw();
    if (readOnly) {
      host.hidden = !getImages().length;
      return;
    }
    const fileInput = host.querySelector('.image-file');
    host.querySelector('.image-upload').addEventListener('click', () => fileInput.click());

    async function add(files, pasted) {
      feedback.textContent = '正在读取图片…';
      const stamp = new Date().toISOString().slice(11, 23).replace(/[:.]/g, '');
      const results = await Promise.allSettled(files.map((file, index) => {
        const name = pasted ? `截图-${stamp}-${index + 1}.${extensions[file.type] || 'png'}` : file.name;
        return readImage(file, name);
      }));
      const loaded = results.filter(item => item.status === 'fulfilled').map(item => item.value);
      const saved = await Promise.all(loaded.map(image => stash(image, storage)));
      const failed = results.find(item => item.status === 'rejected');
      if (saved.length) await addImages(saved);
      if (host.isConnected) {
        draw();
        const success = saved.length ? `已添加 ${saved.length} 张图片。` : '';
        feedback.textContent = success + (failed ? failed.reason.message : '');
      }
    }

    function queue(files, pasted) {
      const task = add(files, pasted).catch(() => { feedback.textContent = '添加图片失败，请重新尝试。'; });
      uploads.add(task);
      task.then(() => uploads.delete(task));
    }

    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files);
      if (files.length) queue(files, false);
      fileInput.value = '';
    });
    function paste(event) {
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      const files = Array.from(clipboard.files).filter(file => file.type.startsWith('image/'));
      if (!files.length) {
        for (const item of clipboard.items || []) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) files.push(file);
          }
        }
      }
      if (!files.length) return;
      event.preventDefault();
      queue(files, true);
    }
    host.addEventListener('paste', paste);
    textField?.addEventListener('paste', paste);
  }

  function append(record, incoming) {
    let imageSeq = (record.images || []).reduce((latest, image) => Math.max(latest, image.number), Number.isSafeInteger(record.imageSeq) ? record.imageSeq : 0);
    const images = [...(record.images || []), ...incoming.map(image => ({...image, number: ++imageSeq}))];
    return {images, imageSeq};
  }

  function refresh(host) {
    mounted.get(host)?.();
  }

  window.ReviewImages = {mount, refresh, valid, validData, extensions, append, store, stash, embed};
})();

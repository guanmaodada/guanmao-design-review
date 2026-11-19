(() => {
  // Store original image bytes in a standard, uncompressed ZIP.
  const encoder = new TextEncoder();
  const crcTable = Array.from({length: 256}, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    return value >>> 0;
  });

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
    return (crc ^ 0xffffffff) >>> 0;
  }

  function header(size) {
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    return {bytes, u16: (pos, value) => view.setUint16(pos, value, true), u32: (pos, value) => view.setUint32(pos, value, true)};
  }

  function zip(files) {
    const body = [];
    const directory = [];
    let offset = 0;
    let directorySize = 0;
    for (const {path, data} of files) {
      const name = encoder.encode(path);
      const checksum = crc32(data);
      const entry = header(30);
      entry.u32(0, 0x04034b50);
      entry.u16(4, 20);
      entry.u16(12, 33);
      entry.u32(14, checksum);
      entry.u32(18, data.length);
      entry.u32(22, data.length);
      entry.u16(26, name.length);
      body.push(entry.bytes, name, data);

      const record = header(46);
      record.u32(0, 0x02014b50);
      record.u16(4, 20);
      record.u16(6, 20);
      record.u16(14, 33);
      record.u32(16, checksum);
      record.u32(20, data.length);
      record.u32(24, data.length);
      record.u16(28, name.length);
      record.u32(42, offset);
      directory.push(record.bytes, name);
      offset += entry.bytes.length + name.length + data.length;
      directorySize += record.bytes.length + name.length;
    }
    const end = header(22);
    end.u32(0, 0x06054b50);
    end.u16(8, files.length);
    end.u16(10, files.length);
    end.u32(12, directorySize);
    end.u32(16, offset);
    return new Blob([...body, ...directory, end.bytes], {type: 'application/zip'});
  }

  const oneLine = value => String(value || '').replace(/\s+/g, ' ').trim();
  const ordinal = number => String(number).padStart(2, '0');

  function build(notes, projectTitle) {
    const files = [];
    const lines = [
      '# 设计评审意见', '', `项目：${projectTitle}`, '',
      '按每条意见的页面、场景和评审 ID 定位修改点。先读文字，再查看其下对应的图片。图片说明来自评审者；空缺时结合正文和画面判断。', '',
    ];
    for (const [index, note] of notes.entries()) {
      const record = 'R' + ordinal(index + 1);
      lines.push(`## ${record} · ${oneLine(note.title)}`, '',
        `- 模块：${oneLine(note.section) || '未填写'}`, `- 场景：${oneLine(note.context) || '当前页面'}`,
        `- 评审 ID：${note.id}`, `- 状态：${note.processingProgress || note.status}`);
      if (note.processingMessage) lines.push(`- 修改说明：${oneLine(note.processingMessage)}`);
      if (note.processedAt) lines.push(`- 落实日期：${oneLine(note.processedAt)}`);
      lines.push('', note.text.trim() || '（本条仅附图）', '');
      for (const image of note.images || []) {
        if (!ReviewImages.valid(image, true)) continue;
        const fileId = record + '-P' + ordinal(image.number);
        const path = 'images/' + fileId + '.' + ReviewImages.extensions[image.type];
        const binary = atob(image.data.split(',', 2)[1]);
        files.push({path, data: Uint8Array.from(binary, char => char.charCodeAt(0))});
        lines.push(`- 图 ${image.number} · [${fileId}](${path}) · ${oneLine(image.caption) || '未填写图片说明'}`,
          `  - 原文件名：${oneLine(image.name)}`, '');
      }
    }
    return zip([{path: 'review.md', data: encoder.encode(lines.join('\n'))}, ...files]);
  }

  window.ReviewPackage = {build};
})();

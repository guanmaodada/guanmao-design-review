/* Replace these example pages and the project key when starting a new project. */
const exampleDevices = [
  {id: 'DS-1024', name: '前厅菜单屏', store: '城南示例店', lastOnline: '今天 10:18', online: true, terminal: true},
  {id: 'DS-1025', name: '入口迎宾屏', store: '城南示例店', online: true},
  {id: 'DS-1026', name: '收银台副屏', store: '城南示例店', lastOnline: '今天 10:18', online: false},
  {id: 'DS-1031', name: '橱窗宣传屏', store: '城西示例店', online: true},
  {id: 'DS-1032', name: '点餐区信息屏', store: '城西示例店', online: true},
  {id: 'DS-1033', name: '取餐区提示屏', store: '城西示例店', lastOnline: '昨天 18:24', online: false},
];

function renderDeviceList({scenario}) {
  const devices = exampleDevices.map(device => ({
    ...device,
    online: device.online && !(device.terminal && scenario === 'offline'),
  }));
  const onlineCount = devices.filter(device => device.online).length;
  // These sample values are declared above. Escape dynamic text when adapting this to external data.
  const rows = devices.map(device => `
    <tr data-device="${device.id}" data-online="${device.online}"${device.terminal ? ' data-terminal' : ''}>
      <td class="table-select"><input type="checkbox" aria-label="选择${device.name}"></td>
      <th scope="row"><strong data-device-name>${device.name}</strong><span class="cell-secondary">${device.id}</span></th>
      <td>${device.store}</td>
      <td><span data-device-status class="status-tag${device.online ? ' positive' : ''}">${device.online ? '在线' : '离线'}</span></td>
      <td>${device.online ? '刚刚' : device.lastOnline}</td>
      <td class="table-action-cell"><button class="table-action" type="button" data-action="details" aria-label="查看详情：${device.name}">查看详情</button></td>
    </tr>`).join('');
  return `
    <div class="device-page">
      <div class="section-toolbar">
        <p>查看门店屏幕的在线状态和最后连接时间。</p>
        <button type="button" class="primary" data-action="refresh"${scenario === 'offline' ? ' disabled' : ''}>刷新状态</button>
      </div>
      <p role="status" data-message></p>
      <dl class="overview" aria-label="设备状态概览">
        <div><dt>全部设备</dt><dd>${devices.length}<small>台</small></dd></div>
        <div><dt>在线</dt><dd class="positive">${onlineCount}<small>台</small></dd></div>
        <div><dt>离线</dt><dd>${devices.length - onlineCount}<small>台</small></dd></div>
      </dl>
      <div class="table-card">
        <div class="table-toolbar">
          <div class="table-filters" aria-label="按在线状态筛选">
            <button type="button" data-filter="all" aria-pressed="true">全部设备</button>
            <button type="button" data-filter="true" aria-pressed="false">在线</button>
            <button type="button" data-filter="false" aria-pressed="false">离线</button>
          </div>
          <input type="search" class="table-search" aria-label="搜索设备名称或编号" placeholder="搜索设备名称或编号">
        </div>
        <div class="table-scroll">
          <table aria-label="门店屏幕设备">
            <thead><tr>
              <th scope="col" class="table-select"><input type="checkbox" data-select-visible aria-label="选择当前可见设备"></th>
              <th scope="col">设备名称</th><th scope="col">所属门店</th><th scope="col">状态</th>
              <th scope="col">最后在线</th><th scope="col" class="table-action-cell">操作</th>
            </tr></thead>
            <tbody>${rows}<tr data-empty hidden><td class="table-empty" colspan="6">没有符合条件的设备</td></tr></tbody>
          </table>
        </div>
        <div class="table-footer" role="status" data-table-count></div>
      </div>
      <dialog aria-labelledby="device-details-title">
        <h2 id="device-details-title"></h2>
        <p data-device-summary></p>
        <form method="dialog">
          <button autofocus>关闭</button>
          <button type="button" class="primary" data-action="inspect">进入屏端首页</button>
        </form>
      </dialog>
    </div>`;
}

function mountDeviceList(content) {
  const rows = [...content.querySelectorAll('[data-device]')];
  const filters = [...content.querySelectorAll('[data-filter]')];
  const search = content.querySelector('.table-search');
  const selectVisible = content.querySelector('[data-select-visible]');
  const count = content.querySelector('[data-table-count]');
  const empty = content.querySelector('[data-empty]');

  function updateSelection() {
    const visible = rows.filter(row => !row.hidden);
    const selected = visible.filter(row => row.querySelector('input').checked).length;
    selectVisible.disabled = visible.length === 0;
    selectVisible.checked = visible.length > 0 && selected === visible.length;
    selectVisible.indeterminate = selected > 0 && selected < visible.length;
    count.textContent = selected ? `共 ${visible.length} 台设备，已选 ${selected} 台` : `共 ${visible.length} 台设备`;
  }

  function applyFilters() {
    const filter = filters.find(button => button.getAttribute('aria-pressed') === 'true').dataset.filter;
    const query = search.value.trim().toLowerCase();
    for (const row of rows) {
      const matchesStatus = filter === 'all' || filter === row.dataset.online;
      const name = row.querySelector('[data-device-name]').textContent.toLowerCase();
      row.hidden = !matchesStatus || (!name.includes(query) && !row.dataset.device.toLowerCase().includes(query));
      if (row.hidden) row.querySelector('input').checked = false;
    }
    empty.hidden = rows.some(row => !row.hidden);
    updateSelection();
  }

  for (const button of filters) {
    button.addEventListener('click', () => {
      for (const filter of filters) filter.setAttribute('aria-pressed', String(filter === button));
      applyFilters();
    });
  }
  search.addEventListener('input', applyFilters);
  selectVisible.addEventListener('change', () => {
    for (const row of rows.filter(row => !row.hidden)) row.querySelector('input').checked = selectVisible.checked;
  });
  content.querySelector('table').addEventListener('change', updateSelection);
  updateSelection();
}

window.prototypeConfig = {
  project: 'guanmao-wireframe-example',
  title: '设备巡检原型',
  pages: [
    {
      id: 'devices',
      group: '门店后台',
      title: '设备列表',
      scenarios: [{id: 'normal', title: '设备在线'}, {id: 'offline', title: '设备离线'}],
      render: renderDeviceList,
      mount: mountDeviceList,
      actions: {
        details({control}) {
          const row = control.closest('[data-device]');
          const dialog = control.closest('.device-page').querySelector('dialog');
          dialog.querySelector('h2').textContent = row.querySelector('[data-device-name]').textContent;
          const status = row.querySelector('[data-device-status]').textContent;
          dialog.querySelector('[data-device-summary]').textContent = row.dataset.device + ' · ' + status;
          dialog.querySelector('[data-action="inspect"]').hidden = !row.hasAttribute('data-terminal');
          dialog.showModal();
        },
        inspect({control, navigate, scenario}) {
          control.closest('dialog').close();
          navigate({page: 'screen', scenario});
        },
        refresh({message}) { message('设备状态已刷新。'); },
      },
    },
    {
      id: 'screen',
      group: '终端',
      title: '屏端首页',
      terminal: true,
      scenarios: [{id: 'normal', title: '设备在线'}, {id: 'offline', title: '设备离线'}],
      render({scenario}) {
        const offline = scenario === 'offline';
        return '<h2>前厅菜单屏</h2><p>网络状态：' + (offline ? '离线，可播放缓存内容' : '已连接') + '</p>' +
          '<div class="actions-row"><button type="button" class="primary" data-action="play">开始播放</button>' +
          '<button type="button" data-action="diagnose">查看网络</button></div><p role="status" data-message></p>';
      },
      actions: {
        play({message}) { message('正在播放门店欢迎页。'); },
        diagnose({message, scenario}) { message(scenario === 'offline' ? '请检查网络连接。' : '网络连接正常。'); },
      },
    },
  ],
};

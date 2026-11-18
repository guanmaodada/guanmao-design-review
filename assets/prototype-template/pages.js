/* Replace these example pages and the project key when starting a new project. */
window.prototypeConfig = {
  project: 'guanmao-wireframe-example',
  title: '设备巡检原型',
  pages: [
    {
      id: 'devices',
      group: '门店后台',
      title: '设备列表',
      scenarios: [{id: 'normal', title: '设备在线'}, {id: 'offline', title: '设备离线'}],
      render({scenario}) {
        const offline = scenario === 'offline';
        return '<h2>前厅设备</h2><p>选择设备查看运行状态。</p>' +
          '<table><thead><tr><th scope="col">名称</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>' +
          '<tbody><tr><td>前厅菜单屏</td><td>' + (offline ? '离线' : '在线') + '</td>' +
          '<td><button type="button" data-action="inspect">查看设备</button></td></tr></tbody></table>' +
          '<div class="actions-row"><button type="button" data-action="refresh"' + (offline ? ' disabled' : '') + '>刷新状态</button></div>' +
          '<p role="status" data-message></p>';
      },
      actions: {
        inspect({navigate, scenario}) { navigate({page: 'screen', scenario}); },
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

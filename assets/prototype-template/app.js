document.addEventListener('DOMContentLoaded', () => {
  const {project, title, pages} = window.prototypeConfig;
  const get = id => document.getElementById(id);
  const canvas = get('canvas');
  const nav = get('page-nav');
  const scenarios = get('scenario-nav');
  const terminal = get('terminal-nav');
  const notes = DevNotes.create({project, fileName: title});
  const historyTrail = [];
  const pageLinks = [];

  function normalize(route = {}) {
    const page = pages.find(item => item.id === route.page) || pages[0];
    const scenario = page.scenarios.find(item => item.id === route.scenario) || page.scenarios[0];
    return {page: page.id, scenario: scenario.id, layout: route.layout === 'portrait' ? 'portrait' : 'landscape'};
  }

  function readLocation() {
    return Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
  }

  function href(route) {
    return '#' + new URLSearchParams(route);
  }

  let route = normalize(location.hash ? readLocation() : notes.initialView);
  const activePage = () => pages.find(item => item.id === route.page);
  const activeScenario = () => activePage().scenarios.find(item => item.id === route.scenario);
  function reviewContext() {
    const page = activePage();
    const scene = activeScenario();
    return {
      id: [page.id, scene.id, ...(page.terminal ? [route.layout] : [])].join('/'),
      title: page.title + ' · ' + scene.title,
      section: page.group,
      description: scene.title + (page.terminal ? route.layout === 'portrait' ? ' · 竖屏' : ' · 横屏' : ''),
    };
  }
  const review = PageReview.attachDrawer({project, context: reviewContext()});

  function addButton(host, caption, action, pressed) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = caption;
    if (pressed !== undefined) button.setAttribute('aria-pressed', String(pressed));
    button.addEventListener('click', action);
    host.append(button);
  }

  function navigate(next, {focus = false} = {}) {
    const target = normalize({...route, ...next});
    if (href(target) === href(route)) return;
    historyTrail.push({route, action: document.activeElement?.dataset.action});
    route = target;
    history.replaceState(null, '', href(route));
    render();
    if (focus) focusCanvas();
  }

  function goBack() {
    const previous = historyTrail.pop();
    if (!previous) return;
    route = previous.route;
    history.replaceState(null, '', href(route));
    render();
    focusCanvas(previous.action);
  }

  function focusCanvas(action) {
    const candidates = focusable();
    (candidates.find(item => item.dataset.action === action) || candidates[0] || canvas).focus({preventScroll: true});
  }

  function focusable() {
    return Array.from(canvas.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled)'))
      .filter(item => item.getClientRects().length && !item.closest('[inert]'));
  }

  function remote(key) {
    if (canvas.classList.contains('dn-point-picking')) return;
    if (key === 'Back') return goBack();
    const candidates = focusable();
    const current = candidates.indexOf(document.activeElement);
    if (key === 'Enter') {
      if (current < 0) focusCanvas();
      else candidates[current].click();
      return;
    }
    const step = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
    const next = current < 0 ? 0 : Math.max(0, Math.min(candidates.length - 1, current + step));
    candidates[next]?.focus();
  }

  function render() {
    const page = activePage();
    get('page-path').textContent = [page.group, page.title].join(' / ');
    get('page-title').textContent = page.title;
    document.title = page.title + ' · ' + title;
    for (const {link, pageId} of pageLinks) {
      link.href = href(normalize({page: pageId, layout: route.layout}));
      if (pageId === page.id) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    scenarios.replaceChildren();
    for (const scene of page.scenarios) {
      addButton(scenarios, scene.title, () => navigate({scenario: scene.id}), scene.id === route.scenario);
    }
    terminal.hidden = !page.terminal;
    terminal.replaceChildren();
    if (page.terminal) {
      for (const [layout, label] of [['landscape', '横屏'], ['portrait', '竖屏']]) {
        addButton(terminal, label, () => navigate({layout}), route.layout === layout);
      }
      const buttons = [['Back', '返回'], ['ArrowLeft', '左'], ['ArrowUp', '上'],
        ['ArrowDown', '下'], ['ArrowRight', '右'], ['Enter', '确认']];
      for (const [key, label] of buttons) {
        addButton(terminal, label, () => remote(key));
        terminal.lastElementChild.addEventListener('mousedown', event => event.preventDefault());
      }
    }
    canvas.dataset.layout = page.terminal ? route.layout : 'web';
    const content = document.createElement('div');
    content.className = 'screen-content';
    content.innerHTML = page.render(route);
    canvas.replaceChildren(content);
    page.mount?.(content);
    notes.mount({pageId: page.id, title: page.title, stage: canvas, controls: get('prototype-actions'), view: route});
    review.setContext(reviewContext());
  }

  get('project-title').textContent = title;
  const groups = new Map();
  for (const page of pages) {
    if (!groups.has(page.group)) {
      const group = document.createElement('div');
      group.className = 'nav-group';
      const heading = document.createElement('h2');
      heading.textContent = page.group;
      group.append(heading);
      groups.set(page.group, group);
      nav.append(group);
    }
    const link = document.createElement('a');
    link.textContent = page.title;
    link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate({page: page.id, scenario: undefined}, {focus: true});
    });
    groups.get(page.group).append(link);
    pageLinks.push({link, pageId: page.id});
  }

  canvas.addEventListener('click', event => {
    const control = event.target.closest('[data-action]');
    if (!control) return;
    activePage().actions?.[control.dataset.action]?.({
      ...route,
      control,
      navigate: next => navigate(next, {focus: true}),
      message: text => { canvas.querySelector('[data-message]').textContent = text; },
    });
  });
  canvas.addEventListener('keydown', event => {
    if (!activePage().terminal || event.target.matches('input, textarea, select')) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Backspace'].includes(event.key)) return;
    event.preventDefault();
    remote(['Escape', 'Backspace'].includes(event.key) ? 'Back' : event.key);
  });
  window.addEventListener('hashchange', () => {
    route = normalize(readLocation());
    render();
  });
  render();
});

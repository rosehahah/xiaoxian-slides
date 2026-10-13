/* 小苋演示 — no network, no dependencies, no executable slide content. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const viewport = $('viewport');
  const toolbar = $('toolbar');
  const layouts = new Set(['cover', 'statement', 'split', 'cards', 'steps', 'timeline', 'quote', 'end']);
  const themes = new Set(['paper', 'blue', 'ink', 'lime', 'coral']);
  let deck;
  try {
    deck = JSON.parse($('deck-data').textContent);
    if (!deck || !Array.isArray(deck.slides) || !deck.slides.length) throw new Error('Missing slides');
  } catch (error) {
    stage.style.cssText = 'padding:80px;color:#191b1a;font-size:40px';
    stage.textContent = '演示数据无法读取。请重新运行构建命令生成 HTML。';
    $('toolbar').hidden = true;
    return;
  }
  const string = (value) => typeof value === 'string' ? value : '';
  const slides = deck.slides;
  let index = 0;
  let ready = false;
  let presenterWindow = null;
  let lastFocus = null;
  let toastTimeout;
  let controlsTimeout;
  let totalElapsed = 0;
  let slideElapsed = 0;
  let timerRunning = false;
  let lastTick = performance.now();
  const params = new URLSearchParams(location.search);
  const isPresenter = params.get('presenter') === '1';
  const randomId = () => globalThis.crypto && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const requestedInstance = params.get('instance');
  const hasInstance = typeof requestedInstance === 'string' && /^[a-zA-Z0-9-]{8,100}$/.test(requestedInstance);
  const instance = isPresenter && hasInstance ? requestedInstance : randomId();
  const senderId = randomId();
  const senderRole = isPresenter ? 'presenter' : 'main';
  let messageSequence = 0;
  let syncChannel = null;
  let storageAvailable = false;
  const seenPackets = new Set();
  const hashText = JSON.stringify(deck);
  let hash = 2166136261;
  for (let n = 0; n < hashText.length; n += 1) hash = Math.imul(hash ^ hashText.charCodeAt(n), 16777619);
  const identity = `xiaoxian-${(hash >>> 0).toString(16)}-${hashText.length}`;
  // file: reports file:// in location.origin, but messages can arrive with origin null.
  // A file target must use '*'; source, deck fingerprint and per-window instance still bind it.
  const opaqueOrigin = location.protocol === 'file:' || location.origin === 'null';
  const messageOrigin = opaqueOrigin ? '*' : location.origin;
  const syncName = `xiaoxian-slides:${identity}:${instance}`;
  const storageKey = (role) => `${syncName}:${role}`;
  const node = (tag, className, value) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = string(value);
    return element;
  };
  const appendText = (parent, tag, className, value) => {
    if (!string(value)) return null;
    const element = node(tag, className, value);
    parent.append(element);
    return element;
  };
  const geometric = () => {
    const art = node('div', 'geometric-art');
    art.setAttribute('aria-hidden', 'true');
    ['art-disc', 'art-orbit', 'art-cross'].forEach((name) => art.append(node('div', name)));
    art.append(node('div', 'art-arrow', '↗'));
    return art;
  };
  const imageNode = (slide, className) => {
    // build.mjs embeds validated local raster images. No remote URL is requested here.
    if (!/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(string(slide.image))) return null;
    const img = node('img', className);
    img.src = slide.image;
    img.alt = string(slide.imageAlt);
    img.draggable = false;
    return img;
  };
  const makeItems = (items, containerClass, itemClass, max) => {
    const cleanItems = Array.isArray(items) ? items.slice(0, max) : [];
    const group = node('div', containerClass);
    group.style.setProperty('--items', String(Math.max(cleanItems.length, 1)));
    group.dataset.count = String(cleanItems.length);
    cleanItems.forEach((item, itemIndex) => {
      const itemNode = node('div', itemClass);
      itemNode.style.setProperty('--item-index', String(itemIndex));
      itemNode.append(node('span', 'item-number', String(itemIndex + 1).padStart(2, '0')));
      appendText(itemNode, 'h3', '', item.title);
      appendText(itemNode, 'p', '', item.body);
      group.append(itemNode);
    });
    return group;
  };
  slides.forEach((slide, slideIndex) => {
    const layout = layouts.has(slide.layout) ? slide.layout : 'statement';
    const theme = themes.has(slide.theme) ? slide.theme : 'paper';
    const section = node('section', `slide layout-${layout} theme-${theme}`);
    section.id = `slide-${slideIndex + 1}`;
    section.setAttribute('aria-roledescription', '幻灯片');
    section.setAttribute('aria-label', `${slideIndex + 1} / ${slides.length}，${string(slide.title).replace(/\n/g, ' ')}`);
    section.setAttribute('aria-hidden', 'true');
    section.inert = true;
    const header = node('header', 'slide-header');
    const chapter = node('div', 'chapter');
    chapter.append(node('span', 'chapter-label', string(deck.title)));
    header.append(chapter, node('span', 'slide-brand', '小苋演示'));
    const content = node('div', 'content');
    const titleBlock = node('div', 'layout-title');
    const title = node(layout === 'cover' ? 'h1' : 'h2', '', string(slide.title));
    const addKicker = (parent) => appendText(parent, 'p', 'kicker', slide.kicker);
    const addBody = (parent) => appendText(parent, 'p', 'body', slide.body);
    if (layout === 'cover') {
      titleBlock.classList.add('cover-copy');
      addKicker(titleBlock); titleBlock.append(title); addBody(titleBlock);
      content.append(titleBlock);
      const img = imageNode(slide, '');
      if (img) { const frame = node('figure', 'cover-image'); frame.append(img); content.append(frame); }
      else content.append(geometric());
    } else if (layout === 'statement') {
      addKicker(content); content.append(title); addBody(content);
      content.append(node('div', 'statement-mark', String(slideIndex + 1).padStart(2, '0')));
      content.lastChild.setAttribute('aria-hidden', 'true');
    } else if (layout === 'split') {
      addKicker(titleBlock); titleBlock.append(title); addBody(titleBlock);
      content.append(titleBlock);
      const visual = node('div', 'split-visual');
      const img = imageNode(slide, 'split-image');
      if (img) visual.append(img);
      else if (Array.isArray(slide.items) && slide.items.length) {
        const items = makeItems(slide.items, 'split-items', 'split-item', 2);
        while (items.firstChild) visual.append(items.firstChild);
      } else visual.append(geometric());
      content.append(visual);
    } else if (['cards', 'steps', 'timeline'].includes(layout)) {
      addKicker(titleBlock); title.classList.add('page-heading'); titleBlock.append(title);
      appendText(titleBlock, 'p', 'page-description', slide.body);
      content.append(titleBlock);
      const classNames = {cards: ['cards-grid', 'card', 4], steps: ['steps-grid', 'step', 5], timeline: ['timeline-grid', 'milestone', 5]};
      const [groupClass, itemClass, maxItems] = classNames[layout];
      content.append(makeItems(slide.items, groupClass, itemClass, maxItems));
    } else if (layout === 'quote') {
      addKicker(content);
      const mark = node('div', 'quote-mark', '“'); mark.setAttribute('aria-hidden', 'true');
      const quote = node('blockquote', ''); quote.append(title);
      content.append(mark, quote); addBody(content);
    } else {
      addKicker(content); content.append(title); addBody(content);
      const line = node('div', 'end-line'); line.setAttribute('aria-hidden', 'true'); content.append(line);
    }
    const footer = node('footer', 'slide-footer');
    const progress = node('div', 'progress-track');
    progress.setAttribute('aria-hidden', 'true');
    const fill = node('i', 'progress-fill'); fill.style.width = `${((slideIndex + 1) / slides.length) * 100}%`; progress.append(fill);
    footer.append(progress, node('span', 'slide-author', string(deck.author) || string(deck.subtitle) || '让每一页，都有一个值得记住的想法。'), node('span', 'slide-number', `${String(slideIndex + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`));
    section.append(header, content, footer); stage.append(section);
    const li = node('li'); const button = node('button'); button.type = 'button';
    button.append(node('span', 'outline-number', String(slideIndex + 1).padStart(2, '0')), node('span', '', string(slide.title).replace(/\n/g, ' ')));
    button.addEventListener('click', () => { go(slideIndex); closeDialog($('outline-dialog')); });
    li.append(button); $('outline-list').append(li);
  });
  const sections = Array.from(stage.children);
  const outlineButtons = Array.from($('outline-list').querySelectorAll('button'));
  const notify = (message) => {
    $('status').textContent = message;
    $('status').classList.add('visible');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => $('status').classList.remove('visible'), 4000);
  };
  const post = (target, type, extra = {}) => {
    const packet = {app:'xiaoxian-slides', deck:identity, instance, sender:senderRole,
      packet:`${senderId}:${++messageSequence}`, timestamp:Date.now(), type, ...extra};
    // The transports carry only position and random identifiers, never notes or file paths.
    try { if (target && !target.closed) target.postMessage(packet, messageOrigin); } catch (error) { /* fallback below */ }
    try { if (syncChannel) syncChannel.postMessage(packet); } catch (error) { /* storage can recover */ }
    if (storageAvailable) {
      try { localStorage.setItem(storageKey(senderRole), JSON.stringify(packet)); }
      catch (error) { storageAvailable = false; }
    }
  };
  const timeText = (milliseconds) => {
    const seconds = Math.floor(milliseconds / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const refreshPresenter = () => {
    if (!isPresenter) return;
    $('presenter-count').textContent = `${index + 1} / ${slides.length}`;
    $('presenter-previous').disabled = index === 0;
    $('presenter-next').disabled = index === slides.length - 1;
    $('speaker-notes').textContent = string(slides[index].notes) || '这一页没有讲者备注。';
    $('next-title').textContent = slides[index + 1] ? string(slides[index + 1].title) : '已是最后一页。留一点时间给交流。';
    const seconds = Number(slides[index].seconds);
    $('slide-timing').textContent = `本页 ${timeText(slideElapsed)}${Number.isFinite(seconds) && seconds > 0 ? ` / 建议 ${timeText(seconds * 1000)}` : ''}`;
    $('elapsed').textContent = timeText(totalElapsed);
  };
  function go(value, options = {}) {
    const requested = Number(value);
    if (!Number.isFinite(requested)) return index;
    const target = Math.max(0, Math.min(slides.length - 1, Math.trunc(requested)));
    const changed = target !== index;
    const direction = target < index ? 'back' : 'forward';
    sections.forEach((section, n) => {
      const active = n === target;
      section.classList.toggle('active', active);
      section.dataset.direction = direction;
      section.setAttribute('aria-hidden', String(!active));
      section.inert = !active;
      if (active) outlineButtons[n].setAttribute('aria-current', 'page');
      else outlineButtons[n].removeAttribute('aria-current');
    });
    index = target;
    if (changed) slideElapsed = 0;
    $('page-count').textContent = `${index + 1} / ${slides.length}`;
    $('previous').disabled = index === 0;
    $('next').disabled = index === slides.length - 1;
    if (location.hash !== `#slide-${index + 1}`) {
      // replaceState can be blocked for file: pages in some browsers. The hash fallback is safe.
      try { history.replaceState(null, '', `#slide-${index + 1}`); }
      catch (error) { location.hash = `slide-${index + 1}`; }
    }
    refreshPresenter();
    if (options.broadcast !== false) {
      if (isPresenter) post(window.opener, 'navigate', {index});
      else post(presenterWindow, 'state', {index});
    }
    return index;
  }
  const resize = () => {
    const bounds = viewport.getBoundingClientRect();
    const scale = Math.max(.01, Math.min(bounds.width / 1600, bounds.height / 900));
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  };
  const showControls = () => {
    clearTimeout(controlsTimeout);
    if (isPresenter || document.fullscreenElement) return;
    toolbar.classList.remove('controls-hidden');
    controlsTimeout = setTimeout(() => {
      if (!toolbar.matches(':hover') && !toolbar.contains(document.activeElement)) toolbar.classList.add('controls-hidden');
    }, 2800);
  };
  const fitText = () => {
    // CJK glyph ink can extend beyond its line box. Only shrink against an explicit
    // max-height, with a glyph allowance; never compare natural text to its own height.
    // Preserve a minimum readable size. Authors should split pages that still overflow.
    stage.querySelectorAll('h1,h2,h3').forEach((element) => {
      const computed = getComputedStyle(element);
      const initial = parseFloat(computed.fontSize);
      const heightLimit = parseFloat(computed.maxHeight);
      const minimum = element.tagName === 'H3' ? 27 : 58;
      let size = initial;
      while (size > minimum && (element.scrollWidth > element.clientWidth + 2 || (Number.isFinite(heightLimit) && element.scrollHeight > heightLimit + 20))) {
        size -= 2;
        element.style.fontSize = `${size}px`;
      }
    });
  };
  function closeDialog(dialog) {
    if (!dialog.open) return;
    dialog.close();
    const focusTarget = document.fullscreenElement && toolbar.contains(lastFocus) ? viewport : lastFocus;
    if (focusTarget && focusTarget.isConnected) focusTarget.focus({preventScroll:true});
  }
  const openDialog = (dialog) => {
    if (isPresenter || dialog.open) return;
    lastFocus = document.activeElement;
    dialog.showModal();
    const activeButton = dialog.id === 'outline-dialog' ? outlineButtons[index] : dialog.querySelector('button');
    if (activeButton) activeButton.focus();
  };
  document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.querySelector('.close-dialog').addEventListener('click', () => closeDialog(dialog));
    // Restore focus synchronously. A queued close event must not steal focus
    // from a later dialog or a control the user has already selected.
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(dialog); });
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog(dialog);
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialog.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')).filter((el) => !el.disabled);
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  });
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else notify('当前浏览器不支持页面全屏，可使用浏览器菜单进入全屏。');
    } catch (error) { notify('未能进入全屏，可使用浏览器菜单进入全屏。'); }
  };
  const openPresenter = () => {
    if (isPresenter) return;
    if (presenterWindow && !presenterWindow.closed) { presenterWindow.focus(); return; }
    const url = new URL(location.href);
    url.searchParams.set('presenter', '1'); url.searchParams.set('instance', instance); url.hash = `slide-${index + 1}`;
    presenterWindow = window.open(url.href, `xiaoxian-presenter-${instance}`, 'popup,width=1280,height=850');
    if (!presenterWindow) notify('讲者窗口被浏览器拦截。请允许此文件打开弹出窗口，然后再按 P。');
    else post(presenterWindow, 'state', {index});
  };
  $('previous').addEventListener('click', () => go(index - 1));
  $('next').addEventListener('click', () => go(index + 1));
  $('outline-button').addEventListener('click', () => openDialog($('outline-dialog')));
  $('help-button').addEventListener('click', () => openDialog($('help-dialog')));
  $('fullscreen-button').addEventListener('click', fullscreen);
  $('presenter-button').addEventListener('click', openPresenter);
  $('print-button').addEventListener('click', () => window.print());
  document.addEventListener('pointermove', showControls, {passive:true});
  document.addEventListener('touchstart', showControls, {passive:true});
  toolbar.addEventListener('pointerleave', showControls);
  toolbar.addEventListener('focusin', showControls);
  toolbar.addEventListener('focusout', showControls);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') showControls();
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const openModal = document.querySelector('dialog[open]');
    if (openModal) {
      if (openModal.id === 'outline-dialog' && event.key.toLowerCase() === 'o') { event.preventDefault(); closeDialog(openModal); }
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target && target.closest('input,textarea,select,[contenteditable="true"]')) return;
    if ([' ', 'Enter'].includes(event.key) && target && target.closest('button,a')) return;
    let action;
    if (['ArrowRight', 'ArrowDown', ' ', 'PageDown'].includes(event.key)) action = () => go(index + 1);
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) action = () => go(index - 1);
    else if (event.key === 'Home') action = () => go(0);
    else if (event.key === 'End') action = () => go(slides.length - 1);
    else if (event.key.toLowerCase() === 'f') action = fullscreen;
    else if (event.key.toLowerCase() === 'o') action = () => openDialog($('outline-dialog'));
    else if (event.key.toLowerCase() === 'p') action = openPresenter;
    else if (event.key === '?') action = () => openDialog($('help-dialog'));
    else if (event.key === 'Escape' && document.fullscreenElement) action = fullscreen;
    if (action) { event.preventDefault(); action(); }
  });
  let touchStart = null;
  viewport.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) { touchStart = null; return; }
    touchStart = {x:event.touches[0].clientX, y:event.touches[0].clientY};
  }, {passive:true});
  viewport.addEventListener('touchend', (event) => {
    if (!touchStart || !event.changedTouches.length || document.querySelector('dialog[open]')) return;
    const dx = event.changedTouches[0].clientX - touchStart.x;
    const dy = event.changedTouches[0].clientY - touchStart.y;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) go(index + (dx < 0 ? 1 : -1));
    touchStart = null;
  }, {passive:true});
  viewport.addEventListener('touchcancel', () => { touchStart = null; }, {passive:true});
  window.addEventListener('hashchange', () => {
    const match = location.hash.match(/^#slide-(\d+)$/);
    if (match) go(Number(match[1]) - 1);
  });
  const receivePacket = (message) => {
    if (!message || message.app !== 'xiaoxian-slides' || message.deck !== identity || message.instance !== instance) return;
    if (message.sender !== (isPresenter ? 'main' : 'presenter')) return;
    if (typeof message.packet !== 'string' || !Number.isFinite(message.timestamp) || Math.abs(Date.now() - message.timestamp) > 30000) return;
    if (seenPackets.has(message.packet)) return;
    seenPackets.add(message.packet);
    if (seenPackets.size > 128) seenPackets.delete(seenPackets.values().next().value);
    if (isPresenter) {
      if (message.type !== 'state' || !Number.isInteger(message.index)) return;
      $('connection-status').textContent = '已连接演示窗口 · 翻页实时同步';
      go(message.index, {broadcast:false});
    } else {
      if (message.type === 'ready') post(presenterWindow, 'state', {index});
      if (message.type === 'navigate' && Number.isInteger(message.index)) go(message.index);
    }
  };
  window.addEventListener('message', (event) => {
    // postMessage always requires the exact paired Window. The independent fallbacks
    // use an unguessable per-main-window channel, never a deck-wide shared channel.
    if (!opaqueOrigin && event.origin !== location.origin) return;
    if (isPresenter ? !window.opener || event.source !== window.opener : !presenterWindow || event.source !== presenterWindow) return;
    receivePacket(event.data);
  });
  if (!isPresenter || hasInstance) {
    try {
      syncChannel = new BroadcastChannel(syncName);
      syncChannel.addEventListener('message', (event) => receivePacket(event.data));
    } catch (error) { /* Some file: browsers do not allow BroadcastChannel. */ }
    try {
      const probe = `${syncName}:probe`;
      localStorage.setItem(probe, '1'); localStorage.removeItem(probe);
      storageAvailable = true;
    } catch (error) { /* Storage may be disabled in private browsing. */ }
    const readStoredPacket = () => {
      if (!storageAvailable) return;
      try {
        const value = localStorage.getItem(storageKey(isPresenter ? 'main' : 'presenter'));
        if (value) receivePacket(JSON.parse(value));
      } catch (error) { /* A blocked or invalid storage entry must not stop playback. */ }
    };
    window.addEventListener('storage', (event) => {
      if (event.key === storageKey(isPresenter ? 'main' : 'presenter')) readStoredPacket();
    });
    // Some browsers suppress both file: message delivery and storage events.
    // Polling the paired instance's one position record recovers without cross-talk.
    const recoveryTimer = setInterval(readStoredPacket, 400);
    window.addEventListener('pagehide', () => {
      clearInterval(recoveryTimer);
      if (syncChannel) syncChannel.close();
      if (storageAvailable) {
        try { localStorage.removeItem(storageKey(senderRole)); } catch (error) { /* best effort */ }
      }
    }, {once:true});
  }
  if (isPresenter) {
    document.body.classList.add('is-presenter');
    $('presenter').hidden = false;
    $('presenter-title').textContent = string(deck.title);
    $('preview-slot').append(viewport);
    document.title = `讲者 · ${string(deck.title)}`;
    $('presenter-previous').addEventListener('click', () => go(index - 1));
    $('presenter-next').addEventListener('click', () => go(index + 1));
    $('timer-toggle').addEventListener('click', () => {
      timerRunning = !timerRunning; lastTick = performance.now();
      $('timer-toggle').textContent = timerRunning ? '暂停计时' : '继续计时';
    });
    $('timer-reset').addEventListener('click', () => { totalElapsed = 0; slideElapsed = 0; lastTick = performance.now(); refreshPresenter(); });
    setInterval(() => {
      const now = performance.now();
      if (timerRunning) { totalElapsed += now - lastTick; slideElapsed += now - lastTick; }
      lastTick = now; refreshPresenter();
    }, 250);
    if (window.opener) post(window.opener, 'ready');
    else $('connection-status').textContent = '独立预览 · 请从演示窗口按 P 打开以同步';
  }
  window.addEventListener('resize', resize);
  document.addEventListener('fullscreenchange', () => {
    const presentingFullscreen = Boolean(document.fullscreenElement) && !isPresenter;
    document.body.classList.toggle('is-fullscreen', presentingFullscreen);
    toolbar.inert = presentingFullscreen;
    clearTimeout(controlsTimeout);
    if (presentingFullscreen) viewport.focus({preventScroll:true});
    if (!presentingFullscreen) showControls();
    $('fullscreen-button').textContent = document.fullscreenElement ? '退出全屏' : '全屏 F';
    resize();
  });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(viewport);
  const hashMatch = location.hash.match(/^#slide-(\d+)$/);
  go(hashMatch ? Number(hashMatch[1]) - 1 : 0, {broadcast:false});
  resize();
  showControls();
  window.xiaoxian = Object.freeze({
    go,
    get current() { return index; },
    get slides() { return slides; },
    get ready() { return ready; }
  });
  const imageReady = Array.from(stage.querySelectorAll('img')).map((img) => {
    if (typeof img.decode === 'function') return img.decode().catch(() => {});
    if (img.complete) return Promise.resolve();
    return new Promise((resolve) => { img.addEventListener('load', resolve, {once:true}); img.addEventListener('error', resolve, {once:true}); });
  });
  Promise.all([document.fonts ? document.fonts.ready : Promise.resolve(), ...imageReady]).then(() => {
    fitText(); resize(); ready = true;
    if (isPresenter && window.opener) post(window.opener, 'ready');
  });
})();

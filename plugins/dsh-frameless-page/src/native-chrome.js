/* ============================================================================
 * dsh-frameless-page — 原生窗口「灵动岛」胶囊 v2
 * ----------------------------------------------------------------------------
 * 外壳提供 windowChrome 能力时（打了 pill 补丁的 DSH-Portable），页面在窗口
 * 顶部正中浮出一个胶囊：
 *   · 收起态：更大的胶囊，内部是红/绿/蓝三个圆点；会话运行中三点交替闪烁。
 *   · 悬停 0.5s 展开：完整显示 文件 / 视图 / 帮助 / 最小化 / 最大化 / 关闭。
 *   · 空间不足时按三档自适应：完整 → 压缩（首按钮变 •••，折叠项进二级菜单）
 *     → 完全不展开（点击胶囊弹二级菜单，关闭固定排在最后）。
 *   · 按住胶囊本体（非按钮）拖动整个原生窗口；双击最大化/还原。
 *   · 文件/视图/帮助 由外壳弹原生菜单；最小化/最大化/关闭走原生 window-control。
 * 没有 windowChrome 能力时 supported() 返回 false，entry.js 回退到浮层模式。
 * ========================================================================== */
(function () {
  "use strict";

  var NS = "dsh-frameless-page";
  var STYLE_TAG = NS + "/island.css";
  var HOVER_EXPAND_DELAY = 250;
  var HOVER_COLLAPSE_DELAY = 1200;
  var HOVER_TIGHT_HOLD = 320;
  var MENU_LEAVE_DELAY = 260;
  var BUSY_POLL_MS = 400;

  var CSS = String.raw`
.dfp-island{position:fixed;top:44px;left:50%;transform:translateX(-50%);z-index:2147483000;
  display:flex;align-items:center;justify-content:center;--dfp-h:22px;height:var(--dfp-h);border-radius:999px;
  background:var(--dfp-surface-bg,color-mix(in srgb,var(--dsw-alias-bg-layer-3,#1a1c20) 82%,transparent));
  border:1px solid var(--dfp-surface-border,rgba(255,255,255,.16));
  box-shadow:var(--dfp-surface-shadow,0 4px 16px rgba(0,0,0,.16));
  color:var(--dfp-surface-color,color-mix(in srgb,var(--dsw-alias-label-secondary,#b7bdc7) 90%,#fff));
  font-family:var(--dfp-surface-font,var(--dsw-font-family,"Microsoft YaHei UI",system-ui,sans-serif));
  user-select:none;-webkit-user-select:none;white-space:nowrap;
  max-width:calc(100vw - 18px);overflow:hidden;isolation:isolate;
  transition:width 300ms cubic-bezier(.4,0,.2,1),background .2s ease,border-color .2s ease,box-shadow .22s ease}
.dfp-island,.dfp-island *{box-sizing:border-box}
.dfp-island [hidden]{display:none !important}
.dfp-island[data-ui-mode="native"]{display:none}
.dfp-island[data-collapsing="1"] .dfp-island__face{display:none}
.dfp-island[data-hover="0"]:not([data-open="1"]):not([data-menu="1"]):not([data-submenu="1"]){background:transparent !important;border-color:transparent !important;box-shadow:none !important}
.dfp-island[data-hover="1"]:not([data-open="1"]):not([data-menu="1"]):not([data-submenu="1"]){background:transparent !important;box-shadow:none !important}
.dfp-island[data-open="1"]{justify-content:flex-start;transition:width 430ms cubic-bezier(.34,1.45,.5,1),background .2s ease,border-color .2s ease,box-shadow .22s ease}
.dfp-island[data-menu="1"],.dfp-island[data-submenu="1"]{overflow:visible}
.dfp-island__face{position:relative;display:flex;align-items:center;justify-content:center;gap:2px;
  height:100%;padding:0 2px;flex:0 0 auto;z-index:1}
.dfp-island[data-open="1"] .dfp-island__face{display:none}
.dfp-island__dot{--dfp-dot:#fff;width:5px;height:5px;border-radius:50%;flex:0 0 auto;
  background:var(--dfp-dot);opacity:.96;
  box-shadow:0 0 9px 1px color-mix(in srgb,var(--dfp-dot) 5%,transparent),
             0 0 3px 0 color-mix(in srgb,var(--dfp-dot) 12%,transparent),
             0 0 0 1px rgba(0,0,0,.16) inset,
             0 1px 1px rgba(255,255,255,.30) inset}
.dfp-island__dot:nth-child(1){--dfp-dot:#ff5f57}
.dfp-island__dot:nth-child(2){--dfp-dot:#34c759}
.dfp-island__dot:nth-child(3){--dfp-dot:#0a84ff}
.dfp-island[data-busy="1"] .dfp-island__dot{animation:dfp-dot-blink 1.15s ease-in-out infinite}
.dfp-island[data-busy="1"] .dfp-island__dot:nth-child(2){animation-delay:.14s}
.dfp-island[data-busy="1"] .dfp-island__dot:nth-child(3){animation-delay:.28s}
@keyframes dfp-dot-blink{
  0%,100%{opacity:.34;transform:scale(.8);filter:saturate(.72)}
  22%{opacity:1;transform:scale(1.14);filter:saturate(1.3)}
  55%{opacity:.86;transform:scale(1);filter:saturate(1)}
}
.dfp-island__row{position:relative;display:flex;align-items:center;gap:1px;flex:0 0 auto;height:100%;
  padding:0 8px;max-width:none;overflow:hidden;opacity:0;z-index:1;pointer-events:none;
  transform:translateX(7px) scaleX(.985);transform-origin:center;
  transition:opacity 160ms ease,transform 260ms cubic-bezier(.34,1.45,.5,1)}
.dfp-island[data-open="1"] .dfp-island__row{opacity:1;transform:none;pointer-events:auto}
.dfp-island:not([data-open="1"]):not([data-measure="row"]) .dfp-island__row{display:none}
.dfp-island[data-measure="face"]{width:auto !important}
.dfp-island[data-measure="face"] .dfp-island__row{display:none}
.dfp-island[data-measure="face"] .dfp-island__face{display:flex}
.dfp-island[data-measure="row"]{width:auto !important}
.dfp-island[data-measure="row"] .dfp-island__face{display:none}
.dfp-island[data-measure="row"] .dfp-island__row{opacity:1;transform:none;pointer-events:auto}
.dfp-island__btn{height:18px;min-width:20px;display:inline-flex;align-items:center;justify-content:center;
  gap:2px;padding:0 5px;border:0;border-radius:9px;background:transparent;color:inherit;
  font:inherit;font-size:9.5px;line-height:1;cursor:pointer;white-space:nowrap;
  transition:background .12s ease,color .12s ease}
.dfp-island__btn:hover{background:rgba(255,255,255,.11);color:var(--dsw-alias-label-primary,#f2f4f8)}
.dfp-island__btn:focus-visible{outline:2px solid var(--dfp-accent,#7aaaff);outline-offset:-2px}
.dfp-island__btn--icon{width:22px;min-width:22px;padding:0}
.dfp-island__btn--more{width:20px;min-width:20px;padding:0;font-size:11px;letter-spacing:0;line-height:0}
.dfp-island__btn--close:hover{background:#c42b1c;color:#fff}
.dfp-island__btn[data-maximized="1"] .dfp-glyph-max{display:none}
.dfp-island__btn[data-maximized="0"] .dfp-glyph-restore{display:none}
.dfp-island__btn svg{display:block;width:8px;height:8px}
.dfp-island__sep{width:1px;height:9px;margin:0 1px;flex:0 0 auto;
  background:linear-gradient(180deg,transparent,rgba(255,255,255,.22),transparent)}
.dfp-island__menu{position:absolute;top:calc(100% + 7px);right:3px;min-width:140px;padding:4px;
  border-radius:12px;display:none;flex-direction:column;gap:1px;z-index:2;
  background:var(--dfp-surface-bg,color-mix(in srgb,var(--dsw-alias-bg-layer-3,#1a1c20) 92%,transparent));
  border:1px solid var(--dfp-surface-border,rgba(255,255,255,.16));
  box-shadow:var(--dfp-surface-shadow,0 12px 32px rgba(0,0,0,.28));
}
.dfp-island[data-menu="1"] .dfp-island__menu{display:flex}
.dfp-island__menu button{display:flex;align-items:center;justify-content:space-between;gap:12px;
  height:24px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:inherit;
  font:inherit;font-size:10.5px;text-align:left;cursor:pointer;transition:background .12s ease,color .12s ease}
.dfp-island__menu button:hover{background:rgba(255,255,255,.12);color:var(--dsw-alias-label-primary,#f2f4f8)}
.dfp-island__menu button[data-danger="1"]:hover{background:#c42b1c;color:#fff}
.dfp-island__menu hr{height:1px;margin:2px 4px;border:0;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.18),transparent)}
.dfp-island__submenu{position:absolute;top:calc(100% + 7px);left:4px;min-width:172px;padding:4px;
  border-radius:12px;display:none;flex-direction:column;gap:1px;z-index:3;
  background:var(--dfp-surface-bg,color-mix(in srgb,var(--dsw-alias-bg-layer-3,#1a1c20) 92%,transparent));
  border:1px solid var(--dfp-surface-border,rgba(255,255,255,.16));
  box-shadow:var(--dfp-surface-shadow,0 12px 32px rgba(0,0,0,.28));
}
.dfp-island[data-submenu="1"] .dfp-island__submenu{display:flex}
.dfp-island__submenu button{display:flex;align-items:center;justify-content:space-between;gap:18px;
  height:24px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:inherit;
  font:inherit;font-size:10.5px;text-align:left;cursor:pointer;transition:background .12s ease,color .12s ease}
.dfp-island__submenu button:hover{background:rgba(255,255,255,.12);color:var(--dsw-alias-label-primary,#f2f4f8)}
.dfp-island__submenu button .dfp-kbd{opacity:.5;font-size:10px;letter-spacing:.02em}
.dfp-island__submenu hr{height:1px;margin:2px 4px;border:0;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.18),transparent)}html.dfp-window-maximized #root *,html.dfp-window-fullscreen #root *{border-left-color:transparent !important;border-right-color:transparent !important}
html.dfp-window-fullscreen #root{padding-top:0 !important}@media (prefers-reduced-motion:reduce){
  .dfp-island,.dfp-island__row,.dfp-island__dot{transition:none !important;animation:none !important}
}
`;

  var ICONS = {
    min: '<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2.6 6h6.8" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
    max: '<svg class="dfp-glyph-max" width="11" height="11" viewBox="0 0 12 12" fill="none"><rect x="2.6" y="2.6" width="6.8" height="6.8" rx="1" stroke="currentColor" stroke-width="1.05"/></svg>',
    restore: '<svg class="dfp-glyph-restore" width="11" height="11" viewBox="0 0 12 12" fill="none"><rect x="2.5" y="3.7" width="5.8" height="5.8" rx=".9" stroke="currentColor" stroke-width="1.05"/><path d="M4.3 3.5v-.7c0-.5.4-.9.9-.9h4.1c.5 0 .9.4.9.9v4.1c0 .5-.4.9-.9.9h-.7" stroke="currentColor" stroke-width="1.05" stroke-linecap="round"/></svg>',
    close: '<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2.9 2.9l6.2 6.2M9.1 2.9L2.9 9.1" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
  };

  // 原生菜单命令（与外壳 title strip 的 ToolStripItem.Name 对齐；点击通过
  // dsh-portable/window-command 交给外壳执行，页面只负责新 UI 的渲染）。
  var MENUS = {
    file: [
      { id: "new-session", zh: "新会话", en: "New session", keys: "Ctrl+N" },
      { id: "settings", zh: "设置", en: "Settings", keys: "Ctrl+," },
      { sep: true },
      { id: "close", zh: "关闭窗口", en: "Close window", keys: "Ctrl+W" },
      { id: "restart", zh: "重启", en: "Restart" },
      { id: "exit", zh: "退出", en: "Exit", keys: "Ctrl+Q" },
    ],
    view: [
      { id: "reload", zh: "重新加载界面", en: "Reload interface", keys: "Ctrl+R" },
      { sep: true },
      { id: "zoom-in", zh: "放大", en: "Zoom in", keys: "Ctrl++" },
      { id: "zoom-out", zh: "缩小", en: "Zoom out", keys: "Ctrl+-" },
      { id: "zoom-reset", zh: "实际大小", en: "Actual size", keys: "Ctrl+0" },
      { sep: true },
      { id: "maximize", zh: "最大化或还原", en: "Maximize or restore" },
      { id: "fullscreen", zh: "全屏", en: "Full screen", keys: "F11" },
    ],
    help: [
      { id: "product-update", zh: "检查 Portable 更新", en: "Check Portable updates" },
      { id: "engine-update", zh: "检查内核更新", en: "Check core updates" },
      { id: "logs", zh: "打开日志文件夹", en: "Open logs folder" },
    ],
  };

  function nativeHost() {
    var native = window.__DSH_PORTABLE_NATIVE__;
    if (!native || !native.capabilities || native.capabilities.windowChrome !== true) return null;
    if (typeof native.postMessage !== "function" || typeof native.addEventListener !== "function") return null;
    return native;
  }

  function supported() {
    return nativeHost() !== null;
  }

  function injectStyles() {
    if (document.querySelector('style[data-plugin-css="' + STYLE_TAG + '"]')) return;
    var style = document.createElement("style");
    style.setAttribute("data-plugin", NS);
    style.setAttribute("data-plugin-css", STYLE_TAG);
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function mount(options) {
    var opts = options || {};
    var t = typeof opts.t === "function" ? opts.t : function (key) { return key; };
    var host = nativeHost();
    if (!host || !document.body) return null;
    injectStyles();

    var island = document.createElement("div");
    island.className = "dfp-island";
    island.setAttribute("data-open", "0");
    island.setAttribute("data-menu", "0");
    island.setAttribute("data-busy", "0");
    island.setAttribute("data-hover", "0");
    island.setAttribute("data-maximized", "0");
    island.setAttribute("data-fullscreen", "0");
    island.setAttribute("role", "toolbar");
    island.innerHTML =
      '<div class="dfp-island__face" aria-hidden="true">' +
      '  <span class="dfp-island__dot"></span><span class="dfp-island__dot"></span><span class="dfp-island__dot"></span>' +
      "</div>" +
      '<div class="dfp-island__row">' +
      '  <button class="dfp-island__btn dfp-island__btn--more" type="button" data-action="overflow" aria-label="更多">•••</button>' +
      '  <button class="dfp-island__btn" type="button" data-action="file" aria-label="文件">文件</button>' +
      '  <button class="dfp-island__btn" type="button" data-action="toggle-ui" aria-label="切换至老UI">切换至老UI</button>' +
      '  <button class="dfp-island__btn" type="button" data-action="view" aria-label="视图">视图</button>' +
      '  <button class="dfp-island__btn" type="button" data-action="help" aria-label="帮助">帮助</button>' +
      '  <span class="dfp-island__sep" data-part="sep"></span>' +
      '  <button class="dfp-island__btn dfp-island__btn--icon" type="button" data-action="minimize" aria-label="最小化">' + ICONS.min + "</button>" +
      '  <button class="dfp-island__btn dfp-island__btn--icon" type="button" data-action="maximize" data-maximized="0" aria-label="最大化或还原">' + ICONS.max + ICONS.restore + "</button>" +
      '  <button class="dfp-island__btn dfp-island__btn--icon dfp-island__btn--close" type="button" data-action="close" aria-label="关闭窗口">' + ICONS.close + "</button>" +
      "</div>" +
      '<div class="dfp-island__menu" role="menu">' +
      '  <button type="button" data-menu-action="file">文件</button>' +
      '  <button type="button" data-menu-action="view">视图</button>' +
      '  <button type="button" data-menu-action="help">帮助</button>' +
      '  <hr data-menu-part="folded-sep" hidden>' +
      '  <button type="button" data-menu-action="minimize" data-menu-part="folded-action" hidden>最小化</button>' +
      '  <button type="button" data-menu-action="maximize" data-menu-part="folded-action" hidden>最大化 / 还原</button>' +
      '  <button type="button" data-menu-action="close" data-menu-part="folded-action" data-danger="1" hidden>关闭窗口</button>' +
      "</div>" +
      '<div class="dfp-island__submenu" role="menu"></div>';
    document.body.appendChild(island);

    var face = island.querySelector(".dfp-island__face");
    var row = island.querySelector(".dfp-island__row");
    var moreButton = island.querySelector('[data-action="overflow"]');
    var maximizeButton = island.querySelector('.dfp-island__btn[data-action="maximize"]');
    var minimizeButton = island.querySelector('.dfp-island__btn[data-action="minimize"]');
    var closeButton = island.querySelector('.dfp-island__btn[data-action="close"]');
    var menuPanel = island.querySelector(".dfp-island__menu");
    var submenuPanel = island.querySelector(".dfp-island__submenu");
    var submenuKind = null;
    var chinese = /^zh/i.test(document.documentElement.lang || navigator.language || "zh");
    var fileButton = island.querySelector('.dfp-island__btn[data-action="file"]');
    var toggleButton = island.querySelector('.dfp-island__btn[data-action="toggle-ui"]');
    var viewButton = island.querySelector('.dfp-island__btn[data-action="view"]');
    var helpButton = island.querySelector('.dfp-island__btn[data-action="help"]');
    var sep = island.querySelector('[data-part="sep"]');
    var foldedSep = island.querySelector('[data-menu-part="folded-sep"]');
    var foldedActions = island.querySelectorAll('[data-menu-part="folded-action"]');

    var mode = "full";
    var expanded = false;
    var menuOpen = false;
    var state = { maximized: false, fullscreen: false, busy: false, uiMode: "pill" };
    var hoverTimer = 0, collapseTimer = 0, holdTimer = 0, menuLeaveTimer = 0, busyTimer = 0, dragFlagTimer = 0;
    var pressStart = null;
    var dragging = false;
    var collapsedWidth = 60, expandedWidth = 220, measuring = false, collapseDotsTimer = 0;
    var themeObserver = null, themeResampleTimer = 0;
    var widthFull = 205, widthCompact = 132, widthTight = 52;

    function post(message) {
      try { host.postMessage(message); return true; } catch (error) { return false; }
    }

    function closeMenu() {
      clearTimeout(menuLeaveTimer);
      menuOpen = false;
      island.setAttribute("data-menu", "0");
    }

    function measureWidths() {
      if (measuring) return;
      measuring = true;
      var previous = island.style.width;
      island.style.width = "auto";
      island.setAttribute("data-measure", "face");
      var faceWidth = island.getBoundingClientRect().width;
      island.setAttribute("data-measure", "row");
      var rowWidth = island.getBoundingClientRect().width;
      island.removeAttribute("data-measure");
      island.style.width = previous;
      var chromeHeight = Math.round(parseFloat(getComputedStyle(island).height) || 22);
      var dotsLength = Math.max(1, Math.round(faceWidth) - 4);
      collapsedWidth = Math.max(Math.round(dotsLength * 1.5) + 5, chromeHeight);
      expandedWidth = Math.max(150, Math.round(rowWidth) + 1);
      measuring = false;
      island.style.width = (expanded ? expandedWidth : collapsedWidth) + "px";
      positionIsland();
    }

    function setExpanded(value) {
      var next = !!value;
      if (next === expanded) {
        island.setAttribute("data-open", expanded ? "1" : "0");
        return;
      }
      expanded = next;
      if (expanded) { clearTimeout(collapseTimer); clearTimeout(hoverTimer); }
      else { closeMenu(); closeSubmenu(); }
      island.setAttribute("data-open", expanded ? "1" : "0");
      if (expanded) {
        clearTimeout(collapseDotsTimer);
        island.removeAttribute("data-collapsing");
        measure(); measureWidths(); island.style.width = expandedWidth + "px";
      } else {
        island.style.width = collapsedWidth + "px";
        island.setAttribute("data-collapsing", "1");
        clearTimeout(collapseDotsTimer);
        collapseDotsTimer = setTimeout(function () { island.removeAttribute("data-collapsing"); }, 320);
      }
    }

    function closeSubmenu() {
      if (submenuKind === null && island.getAttribute("data-submenu") !== "1") return;
      submenuKind = null;
      island.setAttribute("data-submenu", "0");
      submenuPanel.textContent = "";
    }

    function openSubmenu(kind, anchorButton) {
      closeMenu();
      var entries = MENUS[kind] || [];
      submenuKind = kind;
      submenuPanel.textContent = "";
      for (var i = 0; i < entries.length; i += 1) {
        var entry = entries[i];
        if (entry.sep) { submenuPanel.appendChild(document.createElement("hr")); continue; }
        var button = document.createElement("button");
        button.type = "button";
        button.setAttribute("data-command-id", entry.id);
        var label = document.createElement("span");
        label.textContent = chinese ? entry.zh : entry.en;
        button.appendChild(label);
        if (entry.keys) {
          var kbd = document.createElement("span");
          kbd.className = "dfp-kbd";
          kbd.textContent = entry.keys;
          button.appendChild(kbd);
        }
        button.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          var commandId = this.getAttribute("data-command-id");
          closeSubmenu();
          closeMenu();
          setExpanded(false);
          if (commandId) post({ type: "dsh-portable/window-command", id: commandId });
        });
        submenuPanel.appendChild(button);
      }
      island.setAttribute("data-submenu", "1");
      requestAnimationFrame(function () {
        var islandRect = island.getBoundingClientRect();
        var anchorRect = anchorButton ? anchorButton.getBoundingClientRect() : islandRect;
        var left = anchorRect.left - islandRect.left;
        var maxLeft = Math.max(4, island.clientWidth - submenuPanel.offsetWidth - 4);
        submenuPanel.style.left = Math.max(4, Math.min(maxLeft, left)) + "px";
      });
    }

    function openMenu() {
      closeSubmenu();
      clearTimeout(menuLeaveTimer);
      menuOpen = true;
      island.setAttribute("data-menu", "1");
      if (mode !== "full") setExpanded(true);
    }

    function show(element, visible) {
      if (!element) return;
      if (visible) element.removeAttribute("hidden"); else element.setAttribute("hidden", "");
    }

    function measure() {
      if (mode === "full" && row.scrollWidth > 0) widthFull = row.scrollWidth + 12;
      var available = Math.max(80, window.innerWidth - 24);
      var full = widthFull;
      var compact = widthCompact;
      var tight = widthTight;
      var next = available >= full + 8 ? "full" : available >= compact + 8 ? "compact" : available >= tight + 8 ? "tight" : "none";
      if (next !== mode) {
        mode = next;
        island.setAttribute("data-mode", mode);
        setTimeout(measureWidths, 0);
      }
      var compactish = mode === "compact" || mode === "tight" || mode === "none";
      var tightMode = mode === "tight" || mode === "none";
      show(fileButton, !compactish);
      show(viewButton, !compactish);
      show(helpButton, !compactish);
      show(sep, !compactish);
      show(moreButton, compactish);
      show(minimizeButton, !tightMode);
      show(maximizeButton, !tightMode);
      show(closeButton, !tightMode);
      show(foldedSep, tightMode);
      Array.prototype.forEach.call(foldedActions, function (button) { show(button, tightMode); });
      if (mode === "none" || mode === "tight") {
        if (expanded && !menuOpen) setExpanded(false);
      }
      island.style.maxWidth = "calc(100vw - 18px)";
    }

    function pointerOverChrome(event) {
      try {
        if (event && event.relatedTarget && island.contains(event.relatedTarget)) return true;
        return island.matches(":hover") || island.contains(document.activeElement);
      } catch (error) { return false; }
    }

    function scheduleCollapse() {
      clearTimeout(collapseTimer);
      collapseTimer = setTimeout(function () {
        if (island.matches(":hover") || island.contains(document.activeElement)) return;
        if (menuOpen) closeMenu();
        setExpanded(false);
      }, HOVER_COLLAPSE_DELAY);
    }

    function onDocumentPointerDown(event) {
      var target = event.target;
      var inSubmenu = submenuPanel.contains(target);
      var opensSubmenu = target.closest && target.closest('[data-action="file"],[data-action="view"],[data-action="help"],[data-menu-action="file"],[data-menu-action="view"],[data-menu-action="help"]');
      if (submenuKind !== null && !inSubmenu && !opensSubmenu) closeSubmenu();
      if (island.contains(target)) return;
      closeSubmenu();
      closeMenu();
      setExpanded(false);
    }

    function onDocumentKeyDown(event) {
      if (event.key !== "Escape") return;
      if (state.fullscreen) { event.preventDefault(); post({ type: "dsh-portable/window-control", action: "fullscreen" }); return; }
      if (!menuOpen && !expanded && submenuKind === null) return;
      event.preventDefault();
      if (submenuKind !== null) { closeSubmenu(); return; }
      if (menuOpen) { closeMenu(); return; }
      setExpanded(false);
    }

    function onEnter() {
      island.setAttribute("data-hover", "1");
      if (dragging) return;
      clearTimeout(collapseTimer);
      clearTimeout(hoverTimer);
    }

    function onLeave() {
      island.setAttribute("data-hover", "0");
      clearTimeout(hoverTimer);
      if (expanded) scheduleCollapse();
    }

    // ------------------------------------------------------------------
    // 视觉继承：胶囊的底色/模糊/阴影/描边/文字颜色取自主对话框（composer）。
    // 在附近祖先里挑圆角最大、带玻璃滤镜/半透明底/描边的容器，把其 computed
    // style 复制成 CSS 变量，胶囊与二级菜单都复用同一套变量。
    // ------------------------------------------------------------------
    function sampleComposerTheme() {
      try {
        var seeds = document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]');
        var best = null, bestScore = -1;
        for (var s = 0; s < seeds.length && s < 4; s += 1) {
          var node = seeds[s];
          for (var depth = 0; depth < 8 && node; depth += 1, node = node.parentElement) {
            var cs = getComputedStyle(node);
            var radius = parseFloat(cs.borderTopLeftRadius) || 0;
            if (radius < 10) continue;
            if (node.offsetWidth < 280 || node.offsetHeight < 36) continue;
            var bg = cs.backgroundColor || 'rgba(0, 0, 0, 0)';
            var alpha = 1;
            var match = /rgba?\(([^)]+)\)/.exec(bg);
            if (match) { var parts = match[1].split(','); if (parts.length === 4) alpha = parseFloat(parts[3]); }
            if (alpha < 0.35 && alpha < 0.999) continue;
            var borderWidth = parseFloat(cs.borderTopWidth) || 0;
            var score = radius * 0.3 + (node.offsetWidth * node.offsetHeight) / 9000 + borderWidth * 2 + alpha * 6;
            if (score > bestScore) {
              bestScore = score;
              best = {
                bg: bg, alpha: alpha,
                filter: glass ? cs.backdropFilter : null,
                shadow: cs.boxShadow && cs.boxShadow !== 'none' ? cs.boxShadow : null,
                borderColor: borderWidth > 0 ? cs.borderTopColor : null,
                color: cs.color || null,
                font: cs.fontFamily || null,
              };
            }
          }
        }
        return best;
      } catch (error) { return null; }
    }

    function applyComposerTheme() {
      var theme = sampleComposerTheme();
      if (!theme) return;
      var style = island.style;
      // 完全继承主对话框卡片：底色取实色/半透明色，模糊与边框按原样（无则 none），
      // 阴影沿用卡片自己的 ring/shadow；只有缺失时才回退到内置玻璃默认值。
      if (theme.bg && theme.alpha > 0.18) style.setProperty("--dfp-surface-bg", theme.bg);
      style.setProperty("--dfp-surface-filter", theme.filter || "none");
      style.setProperty("--dfp-surface-shadow", theme.shadow
        || "inset 0 1px 0 rgba(255,255,255,.28), inset 0 -1px 0 rgba(0,0,0,.34), 0 10px 28px -14px rgba(0,0,0,.85)");
      style.setProperty("--dfp-surface-border", theme.borderColor || "rgba(255,255,255,.16)");
      if (theme.color) style.setProperty("--dfp-surface-color", theme.color);
      if (theme.font) style.setProperty("--dfp-surface-font", theme.font);
    }

    function watchComposerTheme() {
      applyComposerTheme();
      setTimeout(applyComposerTheme, 900);
      setTimeout(applyComposerTheme, 2600);
      try {
        themeObserver = new MutationObserver(function () {
          clearTimeout(themeResampleTimer);
          themeResampleTimer = setTimeout(applyComposerTheme, 350);
        });
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
        themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
      } catch (error) { /* ignore */ }
      themeResampleTimer = setTimeout(applyComposerTheme, 4000);
    }

    function applyLocale() {
      var labels = {
        file: t("islandFile") || "文件",
        view: t("islandView") || "视图",
        help: t("islandHelp") || "帮助",
        minimize: t("islandMinimize") || "最小化",
        maximize: t("islandMaximize") || "最大化或还原",
        close: t("islandClose") || "关闭窗口",
        overflow: t("islandMore") || "更多",
      };
      measureWidths();
      fileButton.textContent = labels.file;
      if (toggleButton) toggleButton.textContent = state.uiMode === "native" ? (t("islandToggleNew") || "切换至新UI") : (t("islandToggleOld") || "切换至老UI");
      viewButton.textContent = labels.view;
      helpButton.textContent = labels.help;
      moreButton.setAttribute("aria-label", labels.overflow);
      moreButton.setAttribute("title", labels.overflow);
      minimizeButton.setAttribute("aria-label", labels.minimize);
      minimizeButton.setAttribute("title", labels.minimize);
      closeButton.setAttribute("aria-label", labels.close);
      closeButton.setAttribute("title", labels.close);
      applyState({ maximized: state.maximized, fullscreen: state.fullscreen });
    }

    function applyState(snapshot) {
      if (!snapshot) return;
      state.maximized = snapshot.maximized === true;
      state.fullscreen = snapshot.fullscreen === true;
      if (snapshot.uiMode === "native" || snapshot.uiMode === "pill") state.uiMode = snapshot.uiMode;
      island.setAttribute("data-ui-mode", state.uiMode);
      if (toggleButton) toggleButton.textContent = state.uiMode === "native" ? (t("islandToggleNew") || "切换至新UI") : (t("islandToggleOld") || "切换至老UI");
      if (state.uiMode === "native") { closeSubmenu(); closeMenu(); setExpanded(false); }
      var label = state.maximized ? (t("islandRestore") || "还原窗口") : (t("islandMaximize") || "最大化或还原");
      maximizeButton.setAttribute("data-maximized", state.maximized ? "1" : "0");
      maximizeButton.setAttribute("aria-label", label);
      maximizeButton.setAttribute("title", label);
      var menuMax = island.querySelector('[data-menu-action="maximize"]');
      if (menuMax) menuMax.textContent = label;
      island.setAttribute("data-fullscreen", state.fullscreen ? "1" : "0");
      try {
        document.documentElement.classList.toggle("dfp-window-maximized", state.maximized);
        document.documentElement.classList.toggle("dfp-window-fullscreen", state.fullscreen);
      } catch (error) { /* ignore */ }
      if (state.fullscreen) closeSubmenu();
    }

    function isBusyNow() {
      try {
        if (document.querySelector('[data-dsh-busy="true"],[data-running="true"],[class*="streaming"],[class*="generating"],[class*="is-running"]')) return true;
        var buttons = document.querySelectorAll("button,[role='button']");
        for (var i = 0; i < buttons.length; i += 1) {
          var label = (buttons[i].getAttribute("aria-label") || "") + " " + (buttons[i].getAttribute("title") || "") + " " + (buttons[i].textContent || "");
          if (/停止|stop generating|stop/i.test(label)) return true;
        }
      } catch (error) { /* ignore */ }
      return false;
    }

    function refreshBusy() {
      var busy = isBusyNow();
      if (busy === state.busy) return;
      state.busy = busy;
      island.setAttribute("data-busy", busy ? "1" : "0");
      if (busy) { closeSubmenu(); closeMenu(); setExpanded(false); }
    }

    function onMessage(event) {
      var data = event && event.data;
      if (!data || data.type !== "dsh-portable/window-state") return;
      applyState(data);
    }
    try { host.addEventListener("message", onMessage); } catch (error) { /* no channel */ }

    function startDrag() {
      closeSubmenu();
      setExpanded(false);
      post({ type: "dsh-portable/window-drag" });
    }

    function onFacePointerDown(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      dragging = true;
      clearTimeout(dragFlagTimer);
      dragFlagTimer = setTimeout(function () { dragging = false; }, 1400);
      clearTimeout(hoverTimer);
      setExpanded(false);
      pressStart = { x: event.clientX, y: event.clientY, moved: false };
      clearTimeout(holdTimer);
      if (mode === "tight" || mode === "none") {
        // tight: short click opens the secondary menu, holding drags the window
        holdTimer = setTimeout(function () {
          if (pressStart && !pressStart.moved) startDrag();
        }, HOVER_TIGHT_HOLD);
      } else {
        post({ type: "dsh-portable/window-drag" });
      }
    }

    function onFacePointerMove(event) {
      if (!pressStart) return;
      if (Math.abs(event.clientX - pressStart.x) + Math.abs(event.clientY - pressStart.y) > 4) {
        pressStart.moved = true;
        clearTimeout(holdTimer);
        if (mode === "tight" || mode === "none") startDrag();
      }
    }

    function onFacePointerUp() {
      clearTimeout(holdTimer);
      clearTimeout(dragFlagTimer);
      dragFlagTimer = setTimeout(function () { dragging = false; }, 320);
      if ((mode === "tight" || mode === "none") && pressStart && !pressStart.moved) openMenu();
      pressStart = null;
    }

    function onFaceDoubleClick(event) {
      event.preventDefault();
      event.stopPropagation();
      post({ type: "dsh-portable/window-control", action: "maximize" });
    }

    function onButtonClick(event) {
      var button = event.currentTarget;
      var action = button.getAttribute("data-action");
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (action === "overflow") {
        if (menuOpen) closeMenu(); else openMenu();
        return;
      }
      if (action === "toggle-ui") {
        closeSubmenu();
        closeMenu();
        setExpanded(false);
        post({ type: "dsh-portable/ui-mode", mode: "native" });
        return;
      }
      if (action === "file" || action === "view" || action === "help") {
        openSubmenu(action, button);
        return;
      }
      if (action === "close") island.setAttribute("data-busy", "0");
      post({ type: "dsh-portable/window-control", action: action });
    }

    function onMenuAction(event) {
      var button = event.currentTarget;
      var action = button.getAttribute("data-menu-action");
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (action === "file" || action === "view" || action === "help") {
        openSubmenu(action, null);
        return;
      }
      closeMenu();
      setExpanded(false);
      post({ type: "dsh-portable/window-control", action: action });
    }

    var pressState = null, pressHoldTimer = 0;
    function pressIsControl(target) {
      return !!(target.closest && target.closest(".dfp-island__btn,[data-menu-action],.dfp-island__menu,.dfp-island__submenu"));
    }
    function onIslandPointerDown(event) {
      if (event.button !== 0 || pressIsControl(event.target)) return;
      event.preventDefault();
      try { island.setPointerCapture(event.pointerId); } catch (error) { /* ignore */ }
      pressState = { x: event.clientX, y: event.clientY, moved: false };
      clearTimeout(pressHoldTimer);
      if (mode === "tight" || mode === "none") {
        pressHoldTimer = setTimeout(function () {
          if (pressState && !pressState.moved) { pressState.moved = true; startDrag(); pressState = null; }
        }, HOVER_TIGHT_HOLD);
      }
    }
    function onIslandPointerMove(event) {
      if (!pressState || pressState.moved) return;
      if (Math.abs(event.clientX - pressState.x) + Math.abs(event.clientY - pressState.y) > 3) {
        pressState.moved = true;
        pressState = null;
        clearTimeout(pressHoldTimer);
        startDrag();
      }
    }
    function onIslandPointerUp(event) {
      clearTimeout(pressHoldTimer);
      try { if (event && event.pointerId !== undefined) island.releasePointerCapture(event.pointerId); } catch (error) { /* ignore */ }
      if (pressState && !pressState.moved) {
        if (state.fullscreen) post({ type: "dsh-portable/window-control", action: "fullscreen" });
        else if (mode === "tight" || mode === "none") openMenu();
        else setExpanded(!expanded);
      }
      pressState = null;
    }
    function onIslandDoubleClick(event) {
      if (pressIsControl(event.target)) return;
      event.preventDefault();
      post({ type: "dsh-portable/window-control", action: "maximize" });
    }
    island.addEventListener("pointerdown", onIslandPointerDown);
    island.addEventListener("pointermove", onIslandPointerMove);
    island.addEventListener("pointerup", onIslandPointerUp);
    island.addEventListener("pointercancel", onIslandPointerUp);
    island.addEventListener("dblclick", onIslandDoubleClick);

    // 新UI：页面顶部 10% 的非交互区域按住拖动即移动窗口（按钮/输入/标签页等除外）。
    var pageDragPress = null;
    function pageDragExempt(target) {
      if (!target || !target.closest) return false;
      return !!target.closest('button,a,input,textarea,select,summary,label,' +
        '[contenteditable="true"],[contenteditable=""],[role="button"],[role="menuitem"],' +
        '[role="tab"],[role="checkbox"],[role="switch"],[role="textbox"],[role="slider"],' +
        '[role="combobox"],[data-no-window-drag]');
    }
    function onPageDragDown(event) {
      if (state.uiMode !== "pill" || event.button !== 0) return;
      if (event.clientY > window.innerHeight * 0.05) return;
      if (island.contains(event.target)) return;
      if (pageDragExempt(event.target)) return;
      pageDragPress = { x: event.clientX, y: event.clientY };
    }
    function onPageDragMove(event) {
      if (!pageDragPress) return;
      if (Math.abs(event.clientX - pageDragPress.x) + Math.abs(event.clientY - pageDragPress.y) > 3) {
        pageDragPress = null;
        if (event.cancelable) event.preventDefault();
        startDrag();
      }
    }
    function onPageDragUp() { pageDragPress = null; }
    document.addEventListener("pointerdown", onPageDragDown, true);
    document.addEventListener("pointermove", onPageDragMove, true);
    document.addEventListener("pointerup", onPageDragUp, true);
    document.addEventListener("pointercancel", onPageDragUp, true);
    function onPageDoubleClick(event) {
      if (state.uiMode !== "pill") return;
      if (event.clientY > window.innerHeight * 0.05) return;
      if (island.contains(event.target)) return;
      if (event.cancelable) event.preventDefault();
      post({ type: "dsh-portable/window-control", action: "maximize" });
    }
    document.addEventListener("dblclick", onPageDoubleClick, true);
    Array.prototype.forEach.call(island.querySelectorAll(".dfp-island__btn[data-action]"), function (button) {
      button.addEventListener("click", onButtonClick);
    });
    Array.prototype.forEach.call(island.querySelectorAll("[data-menu-action]"), function (button) {
      button.addEventListener("click", onMenuAction);
    });

    island.addEventListener("pointerenter", onEnter);
    island.addEventListener("pointerleave", onLeave);
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    document.addEventListener("keydown", onDocumentKeyDown, true);
    menuPanel.addEventListener("pointerenter", function () { clearTimeout(menuLeaveTimer); });
    menuPanel.addEventListener("pointerleave", function () {
      clearTimeout(menuLeaveTimer);
      menuLeaveTimer = setTimeout(closeMenu, MENU_LEAVE_DELAY);
    });

    function anchorTop() {
      var tags = ["对话", "轨迹", "上下文"];
      var lower = null, upper = null;
      var candidates = document.querySelectorAll('[role="tab"],button,span,div,a');
      for (var i = 0; i < candidates.length; i += 1) {
        var node = candidates[i];
        if (node.children.length !== 0) continue;
        var text = (node.textContent || "").trim();
        if (!text) continue;
        if (!lower && tags.indexOf(text) !== -1) { lower = node; }
        if (!upper && /智能团队|标准模式|子智能体/.test(text)) { upper = node; }
        if (lower && upper) break;
      }
      var height = island.getBoundingClientRect().height || 24;
      if (lower && upper) {
        var lr = lower.getBoundingClientRect();
        var ur = upper.getBoundingClientRect();
        var centre = (ur.top + ur.bottom + lr.top + lr.bottom) / 4;
        return Math.max(4, Math.min(window.innerHeight - height - 4, centre - height / 2));
      }
      if (lower) {
        var onlyLower = lower.getBoundingClientRect();
        return Math.max(4, onlyLower.top - height - 4);
      }
      return 44;
    }

    function positionIsland() {
      var width = collapsedWidth || island.getBoundingClientRect().width || 56;
      var margin = Math.max(1, Math.round(width * 0.25) - 5);
      island.style.top = margin + "px";
      try { document.documentElement.classList.add("dfp-island-host"); } catch (error) { /* ignore */ }
    }

    function refreshBounds() {
      positionIsland();
      island.style.maxWidth = "calc(100vw - 20px)";
      var rect = island.getBoundingClientRect();
      var left = Math.max(10, Math.min(Math.max(10, window.innerWidth - rect.width - 10), rect.left));
      if (Math.abs(left - rect.left) > 0.5) {
        island.style.left = "0";
        island.style.transform = "none";
        island.style.marginLeft = left + "px";
      } else if (island.style.marginLeft) {
        island.style.left = "50%";
        island.style.transform = "translateX(-50%)";
        island.style.marginLeft = "";
      }
    }

    applyLocale();
    island.setAttribute("data-mode", "full");
    requestAnimationFrame(function () {
      measure();
      measureWidths();
      refreshBounds();
      watchComposerTheme();
      post({ type: "dsh-portable/window-state" });
    });
    function onResize() { measure(); measureWidths(); refreshBounds(); }
    window.addEventListener("resize", onResize);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", onResize);
    busyTimer = setInterval(refreshBusy, BUSY_POLL_MS);

    refreshBusy();

    // Tell the shell the page owns the chrome so the native strip stays out of
    // the layout and native drag / window-control / menu messages are accepted.
    post({ type: "dsh-portable/window-chrome", frameless: true });

    return {
      element: island,
      applyState: applyState,
      setLocale: applyLocale,
      destroy: function () {
        clearInterval(busyTimer);
        clearTimeout(hoverTimer);
        clearTimeout(collapseTimer);
        clearTimeout(holdTimer);
        clearTimeout(menuLeaveTimer);
        clearTimeout(themeResampleTimer);
        if (themeObserver) { try { themeObserver.disconnect(); } catch (error) { /* ignore */ } themeObserver = null; }
        post({ type: "dsh-portable/window-chrome", frameless: false });
        document.documentElement.classList.remove("dfp-island-host", "dfp-window-maximized", "dfp-window-fullscreen");
        document.documentElement.style.removeProperty("--dfp-reserve");
        try { host.removeEventListener("message", onMessage); } catch (error) { /* no channel */ }
        document.removeEventListener("pointerdown", onDocumentPointerDown, true);
        document.removeEventListener("pointerdown", onPageDragDown, true);
        document.removeEventListener("pointermove", onPageDragMove, true);
        document.removeEventListener("pointerup", onPageDragUp, true);
        document.removeEventListener("pointercancel", onPageDragUp, true);
        document.removeEventListener("dblclick", onPageDoubleClick, true);
        document.removeEventListener("keydown", onDocumentKeyDown, true);
        window.removeEventListener("resize", onResize);
        island.remove();
      },
    };
  }

  globalThis.DshFramelessPageNative = { supported: supported, mount: mount };
})();

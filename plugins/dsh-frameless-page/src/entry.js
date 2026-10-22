/* ============================================================================
 * dsh-frameless-page — DSH 客户端入口（仅原生灵动岛）
 * ----------------------------------------------------------------------------
 * 只负责把外壳的 windowChrome 能力接到页面顶部居中的灵动岛胶囊上；
 * 旧的「引力页面」浮层、侧栏入口与 Ctrl+Alt+G 已全部移除。
 * ========================================================================== */
(function () {
  "use strict";

  var NS = "dsh-frameless-page";

  var LOCALES = {
    zh: {
      islandFile: "文件",
      islandView: "视图",
      islandHelp: "帮助",
      islandMore: "更多",
      islandMinimize: "最小化",
      islandMaximize: "最大化或还原",
      islandRestore: "还原窗口",
      islandClose: "关闭窗口",
      islandToggleOld: "切换至老UI",
      islandToggleNew: "切换至新UI",
    },
    en: {
      islandFile: "File",
      islandView: "View",
      islandHelp: "Help",
      islandMore: "More",
      islandMinimize: "Minimize",
      islandMaximize: "Maximize or restore",
      islandRestore: "Restore window",
      islandClose: "Close window",
      islandToggleOld: "Switch to old UI",
      islandToggleNew: "Switch to new UI",
    },
  };

  function apply(ctx) {
    ctx.effect(function () {
      var off = ctx.locale.register(NS, LOCALES);
      return typeof off === "function" ? off : function () {};
    }, NS + ": dictionaries");

    var t = ctx.locale.bind(NS);
    var nativeCore = globalThis.DshFramelessPageNative;
    if (!nativeCore || !nativeCore.supported()) return;

    var mounted = null;
    ctx.effect(function () {
      mounted = nativeCore.mount({ t: t });
      return function () {
        if (mounted) {
          mounted.destroy();
          mounted = null;
        }
      };
    }, NS + ": island");

    ctx.effect(function () {
      var off = ctx.on("locale/change", function () {
        if (mounted) mounted.setLocale();
      });
      return typeof off === "function" ? off : function () {};
    }, NS + ": locale sync");
  }

  exports.name = NS;
  exports.inject = ["locale"];
  exports.apply = apply;
})();

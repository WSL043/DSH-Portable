# dsh-frameless-page

给 **DSH-Portable** 窗口加一个顶部居中的「灵动岛」胶囊，并让页面内容真正铺满整个窗口。

插件有两种工作模式，自动选择：

1. **灵动岛（推荐，需要打了 pill 补丁的外壳）**：外壳把整条原生标题栏移出布局，网页铺满整个窗口；页面顶部中间常驻一个居中的胶囊按钮——收起态（55×30，三个点）按住即可 **拖动整个 Windows 窗口**，鼠标移上去平滑展开为 300×30，露出菜单（原生「文件/视图/帮助」）、最小化、最大化(还原)、关闭。窗口控制与拖动通过 `window-chrome` / `window-drag` / `window-control` / `window-state` 消息交给外壳的原生实现。
2. **浮层兼容模式（原版 0.9.4 外壳）**：外壳没有 `windowChrome` 能力时整体禁用灵动岛，回退为窗口内可拖动、带引力的浮层页面；外壳也会保留原生标题栏，不会出现「没有标题栏又拖不动」的窗口。

![灵动岛胶囊（隔离测试环境截图）](shots/island/island-32-expanded.png)

## 它做了什么

| 位置 | 灵动岛模式 | 浮层兼容模式 |
| --- | --- | --- |
| 顶部居中胶囊（收起） | 三个点；按住拖动窗口；双击最大化 | — |
| 顶部居中胶囊（悬停展开） | DeepSeek Harness + 菜单 + 最小化/最大化/关闭 | — |
| 页面内容 | 原 DSH 界面铺满窗口（无标题行） | 粒子引力场（Canvas 2D）、偏移/倾角读数等 |

原生模式的窗口控制消息（`window-chrome` / `window-drag` / `window-control` / `window-state`）由补丁后的 `DeepSeek-Herness.exe` 提供；完整实现见 `workspace/native-shell/`，补丁说明见 `native-shell/README-native-frameless.md`。

## 旧版浮层模式的行为（兼容模式仍有效）

| 位置 | 行为 |
| --- | --- |
| 标题栏左侧 25% | 页面身份：轨道图标 + “无边框页面 / 无边框 · 可拖动” |
| 标题栏中间 50% | **抓取区**。按住拖动整页（鼠标捕获，1:1 跟手）；悬停触发引力；内有抓取胶囊 + 跟随光标的引力球 |
| 标题栏右侧 25% | 复位位置、关闭页面 |
| 页面内容 | 粒子引力场（Canvas 2D）、状态胶囊、偏移/倾角读数、引力强度与粒子密度控制 |

交互细节：

- **引力**：位移最多约 15px、倾角最多约 1.15°，用弹簧（k=170 / c=24）跟随与回弹；抓取区里的引力球在胶囊内跟随光标；页面顶部会随光标出现引力井光环，粒子被吸向上缘。
- **拖动**：只认抓取区；`pointerdown` + `setPointerCapture`，位置按窗口比例写进 `localStorage`，窗口缩放后仍保持在可视范围内。
- **入口**：左侧栏底部（设置齿轮旁）的轨道图标按钮，或 `Ctrl+Alt+G`。首次装入后第一次进入会自动打开一次，之后记住“已见过”，不再自动弹。
- **关闭**：标题栏 ×、`Esc`；侧栏按钮 / 快捷键可再次打开。
- **无障碍**：抓取区可用方向键微调（Shift 加速），`Home` 复位；按钮都有 `aria-label`；`prefers-reduced-motion: reduce` 时取消倾斜/粒子动画，但打开、拖动照常可用。
- **主题**：颜色、边框、字体全部走 DSH 主题 token（`--dsw-alias-*`），跟随明暗主题；浮层使用 `backdrop-filter` 玻璃底。

## 边界（重要）

- **原生模式**：补丁后的外壳支持 `windowChrome` 等能力时，插件的「无边框」= 系统标题条真的收起了，页面顶部自绘标题栏，抓取区拖动的是**整个原生窗口**；最小化/最大化/关闭也直接作用于原生窗口。
- **兼容模式**：原版 0.9.4 外壳没有这些能力，插件自动退回窗口内浮层，“无边框”仅指页面自身没有系统边框，拖动的是页面而不是窗口。
- 抓取区的 50% 是相对**标题栏内容宽度**的精确值（CSS `flex:1 1 50%`，两侧各 25%），不是估算值；`scripts/e2e.mjs` 会实测 `grab/title = 0.5000`，原生模式在隔离环境实测抓取区 413.12 / 826.24 = 0.5000。

## 安装

要求 DSH `0.2.1-rc.2` 系列、`dsh.client` 客户端模块系统可用（DSH-Portable 0.9.4 / 官方桌面端同代内核均可）。原生模式另需打了 frameless 补丁的 `DeepSeek-Herness.exe`（见 `workspace/native-shell/README-native-frameless.md`）；没有补丁时会自动退回兼容模式。

```powershell
# 1) 打包（在插件目录内）
E:\DSH-Portable\runtime\node\node.exe E:\DSH-Portable\runtime-cache\<hash>\app\node_modules\pnpm\bin\pnpm.cjs pack --pack-destination .artifacts

# 2) 用便携版自带的 dsh CLI 安装（会写 package.json / lockfile / bundles，并做 import 预检）
E:\DSH-Portable\dsh.exe plugin --profile web add file:E:\path\to\dsh-frameless-page-0.1.4.tgz

# 3) 重启 DSH-Portable（关闭窗口/托盘退出后重新打开）
```

> 0.9.4 便携版原本 `dsh.exe plugin add` 的 import 预检会在解析
> `dsh-better-sidebar` 的 `!!js` YAML 标签时失败、导致装任何插件都被回滚。
> 该 bug 已修复（`workspace/portable-preflight-fix/NOTES.md`），现在 `plugin add` 可直接使用。

本地开发也可以直接跑 `node scripts/build-client.mjs` 后把整个目录放进 profile 的 `node_modules/`，再用 `--patch` 挂一行 `dsh-frameless-page` 起一个临时宿主验证。

卸载：

```powershell
E:\DSH-Portable\dsh.exe plugin --profile web remove dsh-frameless-page
```

然后重启。插件只在浏览器端持有 UI，没有宿主路由、没有后台进程，卸载即净。手动回滚见 [INSTALL-NOTES.md](INSTALL-NOTES.md)。

## 开发 / 验收

```powershell
node scripts/build-client.mjs   # src/core.js + src/entry.js -> lib/client.js
node scripts/smoke.mjs          # 包契约 / bundle 外壳 / 关键结构
node scripts/e2e.mjs "http://127.0.0.1:3097/?token=..." --shots shots/integration
```

- 本地视觉预览：`preview/index.html`（直接加载 `src/core.js`，模拟 DSH 深色主题背景；`?open=0` 关闭，`?theme=light` 浅色）。
- 行为验收：`scripts/e2e.mjs` 用 CDP 驱动真实 Chromium，断言 21 项：抓取区精确 50%、首次自动打开、悬停切换引力态、竖直位移与边缘倾角、拖动整页、位置持久化、复位、关闭/重开、Esc、抓取区外不可拖、快捷键、减少动态效果。结果写 `shots/integration/e2e-results.json`。
- 最近一次在 DSH-Portable 测试宿主（`--patch` 关闭 dsh-pet / 启动屏 / 壁纸）上的结果：**21/21 通过**。

## 文件

```
src/core.js        框架无关的浮层实现（DOM / 弹簧 / Canvas 粒子 / 拖拽 / 持久化）
src/native-chrome.js 原生窗口标题栏（windowChrome 能力、50% 抓取区、窗口拖动/最小化/最大化/关闭、引力画布）
src/entry.js       DSH 客户端接线（slots、locale、快捷键、侧栏入口、原生/浮层模式选择）
scripts/build-client.mjs  把三份源码内联成 __ModuleLoader__ 的 client bundle
scripts/e2e.mjs    CDP 行为验收（21 项断言 + 截图）
scripts/smoke.mjs  静态契约检查
lib/client.js      构建产物（勿手改）
lib/index.js       宿主半侧：空 apply，只为让 Loader 挂上插件行
preview/index.html 本地视觉预览
shots/             预览与集成验收截图（shots/native/ 为原生模式隔离环境实测）
```

## 数据与隐私

只用 `localStorage` 保存四样东西：是否已见过（自动打开一次）、页面位置（窗口比例）、引力强度、粒子密度。键前缀 `dsh-frameless-page:`。不联网、不读工作区、不写宿主存储。

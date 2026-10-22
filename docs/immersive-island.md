# 沉浸式灵动岛窗口（新 UI）

这套改动把 DSH-Portable 的窗口外壳从「有标题栏」扩展为两种可切换的界面：

| 模式 | 外观 | 入口 |
| --- | --- | --- |
| 新 UI（`pill`） | 无标题栏，网页铺满窗口，顶部居中一颗灵动岛胶囊 | 胶囊展开行第二项「切换至老UI」可切回 |
| 老 UI（`native`） | 原生标题条（iOS 风格交通灯 + 文件/视图/帮助） | 原生「视图」菜单第一项「切换至新UI」 |

选择会写入 `data/chrome-ui.json`，重启后保持。

## 组成

### 1. 外壳（`launcher/windows/`）

- `LauncherWindow.Immersive.cs`（新增）：灵当岛/无边框相关逻辑、`ShowNativeMenuAt`、`ExecuteDesktopMenuCommand`、`chrome-ui.json` 读写、`SetChromeUiMode`。
- `LauncherWindow.Chrome.cs`：`ApplyFramelessPage`、`BeginDesktopWindowDrag`、`HandleDesktopWindowControl`、窗口状态上报（含 `uiMode`）、`WM_NCHITTEST` 四边/四角缩放、iOS 交通灯、DWM 边框（`DWMWA_COLOR_NONE` 消除白边）、标题条拖动命中恢复。
- `LauncherWindow.Data.cs`：桥接消息
  - `dsh-portable/window-chrome {frameless}`
  - `dsh-portable/window-drag`
  - `dsh-portable/window-control {action: minimize|maximize|close|fullscreen}`
  - `dsh-portable/window-state`
  - `dsh-portable/window-command {id}`
  - `dsh-portable/ui-mode {mode: pill|native}`
- `LauncherWindow.WebView.cs`：能力声明（`windowChrome/windowDrag/windowControls/windowState`）。
- `DesktopChrome.cs`：标题条渲染器（交通灯圆点 + 悬停 −/□/× 提示）。

### 2. 插件（`plugins/dsh-frameless-page/`）

- `src/native-chrome.js`：胶囊的 DOM/CSS/交互全部在这里（尺寸、定位、动画、悬停、拖动、点击、菜单、三点闪烁、全屏、顶部 5% 拖动区与双击最大化、继承主对话框外观）。
- `src/entry.js`：只负责挂载胶囊与注册中英文字典。
- `scripts/build-client.mjs`：把 `src/native-chrome.js` + `src/entry.js` 内联成 `lib/client.js`。
- `lib/`：构建产物（插件加载 `lib/client.js`）。

## 构建

```pwsh
# 外壳（需要 .NET Framework 4.8 csc）
workspace/native-shell/build-shell.ps1

# 插件
cd workspace/dsh-frameless-page
node scripts/build-client.mjs
pnpm pack --pack-destination .artifacts
```

## 安装

```pwsh
# 外壳：替换 DeepSeek-Herness.exe 后重启
# 插件：
dsh.exe plugin --profile web add file:.../dsh-frameless-page-<version>.tgz
```

## 交互约定（新 UI）

- 待机：只显示三个点（胶囊面透明）。
- 悬停：只显示胶囊描边，不展开。
- 单击（位移 <3px，松开时触发）：展开；展开态单击背景收起。
- 按住移动 >3px：拖动 Windows 窗口。
- 展开后鼠标离开 1.2s 收起。
- 顶部 5% 非交互区域：按住拖动窗口；双击最大化/还原。
- 全屏：胶囊保持可见，点击胶囊或 Esc 退出全屏。
- 展开行：文件 / 切换至老UI / 视图 / 帮助 / 最小化 / 最大化 / 关闭；菜单命令由外壳 `window-command` 原生执行。

## 截图

- `plugins/dsh-frameless-page/shots/island/island-32-expanded.png`
- `plugins/dsh-frameless-page/shots/island2/island2-g3-ios-dots18.png`（老 UI 交通灯）
- `plugins/dsh-frameless-page/shots/island2/island2-b1-idle.png`（新 UI 待机三点）
- `plugins/dsh-frameless-page/shots/island2/island2-e2-fullscreen.png`（全屏时胶囊仍可见）

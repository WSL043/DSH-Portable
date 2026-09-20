# ComfyUI 顶部栏与更新交互研究

日期：2026-09-20。范围：官方源码和文档对照，未运行 Comfy Desktop 成品；不代表 Portable 已实现以下建议。
Portable 对照提交：`6d89303e4998aae92708ee72973f404d046d7191`。
调查时 Desktop main：`787b5954cf3d715e67207d6b5b49d49389cbc09c`；Frontend main：`b36caf43edd3acf99b3707f6db41f428a0349e1a`。

## 两层顶部栏应分别研究

Comfy Desktop 的宿主标题栏负责环境身份、窗口操作、菜单、下载和更新状态；ComfyUI frontend 的工作区顶部栏负责工作流及命令。
Portable 应保持同样清楚的责任分工：桌面栏管理 Portable 环境，官方 DSH 管理会话和输入。不能为统一视觉接管官方会话服务。

## 源码中值得借鉴的实现

| 观察 | Portable 取舍 |
| --- | --- |
| `useTitleBarMenus.ts` 从主进程接收菜单开关状态，并防止系统先关闭菜单、同一次点击又将它打开；下载与环境选择菜单由主进程负责切换 | 用实际关闭原因及输入顺序管理状态，重点验收连续点击、点击外部和失焦。不直接照搬其 100ms 常量 |
| `useTitleBarHoverGate.ts` 失焦清除悬浮，收到新的指针移动才重新启用，防止系统菜单导致高亮残留 | 检查 WinForms 菜单与 WebView 边界的高亮、提示清除，不把失焦后的 focus 当作鼠标移动 |
| `TitleBarApp.vue` 将空白容器保留为拖动区域，仅按钮退出拖动区域；为系统窗口按钮预留空间 | 保留原生窗口命中测试，不用网页遮罩盖住标题栏或缩放边缘 |
| 标题内容使用有上下限的宽度、可收缩中间区域，并测量两侧宽度 | 长中文/英文、更新状态变化和高 DPI 下不挤掉窗口按钮；中央信息并非必须新增 |
| `useUpdatePills.ts` 区分应用更新与当前安装的更新，应用状态细分为可更新、下载中、待安装 | 复用现有产品/内核更新结果，增加统一状态展示；不增加另一套后台轮询或下载器 |
| 下载首次状态推送不重复制造“新任务”提示，已读集合随历史列表收敛；卸载清理订阅 | 重开窗口不重复提示旧任务，常驻状态有界；错误不能被成功状态遮盖 |
| frontend `commandStore.ts` 统一命令注册、执行、错误处理和快捷键文本 | 我们已有 AddDesktopCommand/快捷键分发，继续扩展同一入口，避免菜单与快捷键各执行一次 |

## 当前 Portable 不是空白起点

`launcher/windows/DSH-Portable.cs` 已有 36px 标题栏、点击菜单、失焦关闭、菜单阴影关闭、空白处命中透传，以及统一快捷键入口。
因此不能把这些写成此次新实现。需要补证据的地方包括菜单跨 WebView 关闭、关闭后误重开、窄窗口与高 DPI。
目前菜单高度按内容求和后同时设置 MinimumSize/MaximumSize；应验证小工作区域是否仍能完整操作，不能仅凭源码认定已经发生溢出。

## 建议的后续布局

- 左侧保留侧栏、后退/前进、现有菜单；窄窗口是否收为单一菜单，先做本地预览。
- 中间优先保留可拖动空间；确有识别需求时显示简短环境名，不复制官方会话标签栏。
- 右侧仅在有任务时展示紧凑更新/下载状态，始终为最小化、最大化、关闭保留区域。
- 帮助中保留 Star 和反馈，不重新增加重复仓库入口。
- 延续黑白灰、轻边界和短过渡；不照搬品牌黄色、订阅入口、营销提示或多实例管理复杂度。

## 落地顺序及验收条件

1. 菜单生命周期：悬浮不展开；同按钮再次点击关闭；点击 WebView/空白区域、Esc、Alt+Tab 均正确关闭；不误重开、不残留提示，不抢输入焦点。
2. 布局：中英、亮暗、100/125/150/200% DPI、最小支持窗口、最大化/还原、跨屏；菜单不越过工作区域，关闭按钮始终可见，四边和角可缩放。
3. 更新状态：同一真实任务驱动设置页和顶部栏；区分 Portable/内核，检查失败不能显示已是最新；下载失败、重试、待重启、回滚均有明确状态。
4. 生命周期：前端插件启停、重连及界面重载不重复注册命令或订阅；无更新时没有额外动画/轮询；任务历史有上限。
5. 在隔离宿主做 Windows 原生验收；网页预览不代替窗口命中、菜单焦点和多屏 DPI 验收。不控制用户前台输入。

本轮仅形成研究与实施标准，没有替换标题栏、增加 Electron、发布版本或改动用户安装。

## 来源

- [Desktop 菜单状态](https://github.com/Comfy-Org/Comfy-Desktop/blob/787b5954cf3d715e67207d6b5b49d49389cbc09c/src/renderer/src/comfyTitleBar/useTitleBarMenus.ts)
- [悬浮清理](https://github.com/Comfy-Org/Comfy-Desktop/blob/787b5954cf3d715e67207d6b5b49d49389cbc09c/src/renderer/src/comfyTitleBar/useTitleBarHoverGate.ts)
- [标题栏组件与布局](https://github.com/Comfy-Org/Comfy-Desktop/blob/787b5954cf3d715e67207d6b5b49d49389cbc09c/src/renderer/src/comfyTitleBar/TitleBarApp.vue)
- [更新状态](https://github.com/Comfy-Org/Comfy-Desktop/blob/787b5954cf3d715e67207d6b5b49d49389cbc09c/src/renderer/src/comfyTitleBar/useUpdatePills.ts)
- [Frontend 命令注册](https://github.com/Comfy-Org/ComfyUI_frontend/blob/b36caf43edd3acf99b3707f6db41f428a0349e1a/src/stores/commandStore.ts)
- [管理面板](https://docs.comfy.org/installation/desktop/usage/manage)

新 Desktop 的许可证与旧仓库不同；本轮不复制实现，只记录行为要求。若后续复用源码，必须按相应仓库和修订的许可单独处理。

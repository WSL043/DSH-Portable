# 窗口插件与 Portable 的边界

窗口外观属于用户自定义。Portable 提供通用窗口接口，具体布局、动画、灵动岛等由用户自行安装或开发插件；不内置皮肤、`pill/native` 偏好或「切换新 UI」入口。原生菜单和窗口控件是默认状态。

## 能力探测

Windows 默认顶栏参考 [官方桌面实现](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/src/preload-menu.ts) 的 40 DIP 栏高、14px 系统字体、28px 菜单按钮与中性浅深配色。继续复用 Native 的文件、视图、帮助及现有命令，不增加另一套网页菜单或皮肤设置。macOS 和 Linux 沿用各自宿主的窗口机制。

本次仅 Windows Native 实现这些接口。插件先检查宿主 `window.__DSH_PORTABLE_NATIVE__` 的 `protocolVersion === 1` 与 `capabilities`，只有对应能力为 `true` 才通过该宿主的 `postMessage` 发送消息。浏览器、macOS、Linux 或旧版宿主没有声明时，应保留普通页面及系统窗口，不隐藏控件、不模拟调用成功。不要按操作系统名称猜测能力。

| capability | 消息与字段 | 用途 |
| --- | --- | --- |
| `windowChrome` | `dsh-portable/window-chrome`，`frameless: boolean` | 请求由页面提供窗口控制；`false` 恢复原生栏 |
| `windowDrag` | `dsh-portable/window-drag` | 在已接受页面控制且非全屏时拖动 |
| `windowControls` | `dsh-portable/window-control`，`action` 为 `minimize` / `maximize` / `fullscreen` / `close` | 调用既有窗口行为，关闭仍遵循托盘等现有设置 |
| `windowState` | `dsh-portable/window-state` | 查询状态；宿主以同名消息返回状态变化 |
| `windowCommand` | `dsh-portable/window-command`，`id` | 只执行现有且当前可用的原生命令 ID |
| `windowMenu` | `dsh-portable/window-menu`，`menu` 为 `file` / `view` / `help` | 复用当前原生菜单 |

返回状态包含 `frameless`、`maximized`、`minimized`、`fullscreen`、`menuVisible`、`nativeChromeForced`。接口是新增的可选能力，旧内核无需使用，外壳契约仍为 2。

`frameless` 只隐藏宿主绘制的标题和菜单栏，保留系统缩放边缘与原有窗口尺寸限制，不等同于去除全部系统边框。`maximize` 在最大化与还原之间切换，并先退出全屏；`fullscreen` 独立切换全屏。标题按钮、原生菜单与页面接口共用同一组窗口操作。查询和返回状态走相反方向，不需要插件回传宿主的状态消息。

## 恢复与限制

页面导航、重载或渲染失败会恢复原生栏。插件停用前应主动发送 `frameless: false`；官方插件启停重载后的新文档也会恢复默认。托盘的「恢复窗口栏」可以退出页面窗口控制；当前文档再次请求隐藏也不会生效，直到下一次导航。

Native 只提供固定窗口操作与既有菜单，不接受任意可执行文件、脚本或菜单回调。上述桥不是 Node 插件的权限沙箱；安装第三方插件仍需自行评估其权限。插件自己的脚本若在同一文档中异常且未触发导航，用户仍可通过托盘恢复，不宣称能自动发现任意插件故障。

接口设计参考了社区贡献者 [ArtificialAngels 的 PR #181](https://github.com/WSL043/DSH-Portable/pull/181) 中窗口桥接与菜单复用的思路；该 PR 的视觉插件与新旧 UI 偏好没有并入本次实现。

DSH-Portable
============

中文
----

这个文件夹可以直接移动，设置、会话、浏览器资料和默认工作区都会随它保留。

Windows：解压完整后双击 DeepSeek-Herness.exe。移动文件夹或拔出移动盘前，先
运行 Stop DeepSeek-Herness.exe。

macOS：解压完整后双击 DSH-Portable.app。首次被系统拦截时，按住 Control 点按
应用并选择“打开”。移动文件夹或拔出移动盘前，运行 Stop DSH-Portable.command。

启动器会先询问再安装更新。普通更新只下载变化的 DSH 应用组件，不会重复下载
整套运行环境；会话、设置、凭据和工作区不会被覆盖。兼容性变化时才会提示下载
完整包，新版启动失败则自动恢复旧版。

data/dsh-home 保存配置、凭据和会话，data/browser 保存独立浏览器资料，workspace
是随文件夹移动的默认工作区。data 可能包含私人信息，请像保管带密码的移动硬盘
一样保管整个文件夹，并安全弹出移动盘。

English
-------

Keep this folder together. Settings, sessions, browser data, and the default
workspace move with it.

On Windows, extract the archive completely and run DeepSeek-Herness.exe. On
macOS, run DSH-Portable.app; Control-click and choose Open if first launch is
blocked. Use the matching Stop launcher before moving the folder or unplugging
a drive.

The launcher asks before installing an update. A normal update downloads only
the changed DSH application component and keeps sessions, settings, credentials,
and workspace in place. It requests the complete package only across a runtime
compatibility change and restores the old version if the new one cannot start.

DSH binds only to 127.0.0.1. This package contains the official DeepSeek Harness
runtime plus an independent portable launcher; it is not an official DeepSeek
desktop application.

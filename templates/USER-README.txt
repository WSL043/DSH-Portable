DSH-Portable
============

中文
----

整个文件夹就是你的工作环境。设置、会话、插件、桌面数据和默认工作区都会随它
保留。迁移或备份前，从系统托盘选择“退出 DeepSeek Harness”，再复制完整文件夹。

Windows 双击 DeepSeek-Herness.exe。关闭窗口默认收进系统托盘，任务继续运行；
托盘菜单可以打开窗口、完全退出，或把“关闭窗口时”改成直接退出。

macOS 双击 DSH-Portable.app。首次被系统拦截时，按住 Control 点按应用并选择
“打开”。移动文件夹或拔出移动盘前，运行 Stop DSH-Portable.command。

Linux 完整便携目录运行 ./DeepSeek-Herness；AppImage 首次使用前执行 chmod +x。
AppImage 数据保存在同目录的 DSH-Portable-data，迁移时请把两者一起复制。

启动器会先询问再安装更新。普通更新只下载变化的 DSH 应用组件；会话、设置、
凭据和工作区都会保留。Windows 遇到兼容性变化时会直接下载完整版本并原地更新，
不会覆盖 data 与 workspace；新版启动失败会恢复旧版。
Windows 与 Linux 托盘、macOS 应用菜单都可手动检查更新。自动检查默认关闭，需要时可在设置或菜单里开启。
Windows 只在确认没有任务运行时直接更新；macOS 与 Linux 会在下次启动前安装，运行中的任务不会被中断。

Windows：双击 dsh.exe 或从托盘“更多”中打开 DSH 终端，然后可以原样粘贴插件提供的官方命令：

  dsh plugin --profile web add <插件>
  dsh plugin --profile web list --depth 0
  dsh plugin --profile web update <插件包名>
  dsh plugin --profile web remove <插件包名>
  dsh --profile web --dump-config

DSH 终端不会修改系统 PATH。

插件变更不会自动重启 DSH。保存任务并手动退出、重新打开后生效。

Linux 插件命令：

  ./dsh plugin --profile web add <插件>
  ./dsh plugin --profile web list --depth 0
  ./dsh plugin --profile web update <插件包名>
  ./dsh plugin --profile web remove <插件包名>
  ./dsh --profile web --dump-config

English
-------

This folder is the complete work environment. Settings, sessions, plugins,
desktop data, and the default workspace move together. Before copying or backing
it up, choose Exit DeepSeek Harness from the system tray.

On Windows, run DeepSeek-Herness.exe. Closing the window sends it to the tray by
default so active tasks continue. The tray menu can reopen the window, exit the
app, or change close behavior.

On macOS, run DSH-Portable.app. Control-click and choose Open if first launch is
blocked. Run Stop DSH-Portable.command before moving or unplugging the folder.

On Linux, run ./DeepSeek-Herness from the complete portable folder. Make an
AppImage executable once with chmod +x. Its data lives in the sibling
DSH-Portable-data folder; move both together.

The launcher asks before installing an update. A normal update downloads only
the changed DSH application component and keeps sessions, settings, credentials,
and workspace in place. It requests the complete package only across a runtime
compatibility change and restores the previous version after a failed launch.
The Windows and Linux trays and the macOS application menu can check manually.
Automatic checks are off by default and can be enabled from Settings or the menu
when wanted. Windows updates only after confirming that no task is running;
macOS and Linux install before the next launch. Updates never interrupt a running task.

Windows: double-click dsh.exe or open DSH Terminal from the tray's More menu,
then paste the official commands published by plugins without editing them:

  dsh plugin --profile web add <plugin>
  dsh plugin --profile web list --depth 0
  dsh plugin --profile web update <package-name>
  dsh plugin --profile web remove <package-name>
  dsh --profile web --dump-config

DSH Terminal never changes the system PATH.

Plugin changes never restart DSH automatically. Save the task, exit, and reopen
the app when convenient.

Linux plugin commands:

  ./dsh plugin --profile web add <plugin>
  ./dsh plugin --profile web list --depth 0
  ./dsh plugin --profile web update <package-name>
  ./dsh plugin --profile web remove <package-name>
  ./dsh --profile web --dump-config

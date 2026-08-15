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

启动器会先询问再安装更新。普通更新只下载变化的 DSH 应用组件；会话、设置、
凭据和工作区都会保留。兼容性变化时才会提示下载完整包，新版启动失败会恢复旧版。

Windows 插件命令：

  .\dsh.exe plugin --profile web add <插件>
  .\dsh.exe plugin --profile web list --depth 0
  .\dsh.exe plugin --profile web update <插件包名>
  .\dsh.exe plugin --profile web remove <插件包名>
  .\dsh.exe --profile web --dump-config

插件变更不会自动重启 DSH。保存任务并手动退出、重新打开后生效。

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

The launcher asks before installing an update. A normal update downloads only
the changed DSH application component and keeps sessions, settings, credentials,
and workspace in place. It requests the complete package only across a runtime
compatibility change and restores the previous version after a failed launch.

Windows plugin commands:

  .\dsh.exe plugin --profile web add <plugin>
  .\dsh.exe plugin --profile web list --depth 0
  .\dsh.exe plugin --profile web update <package-name>
  .\dsh.exe plugin --profile web remove <package-name>
  .\dsh.exe --profile web --dump-config

Plugin changes never restart DSH automatically. Save the task, exit, and reopen
the app when convenient.

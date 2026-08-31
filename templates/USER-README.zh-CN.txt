DSH-Portable
============

整个文件夹就是你的工作环境。设置、会话、插件、桌面数据和默认工作区都会随它
保留。迁移或备份前，从系统托盘选择「退出 DeepSeek Harness」，再复制完整文件夹。

Windows：双击 DeepSeek-Herness.exe。关闭窗口默认收进系统托盘，任务继续运行；
托盘菜单可以打开窗口、完全退出，或修改关闭窗口时的行为。

macOS：双击 DSH-Portable.app。首次被系统拦截时，按住 Control 点按应用并选择
「打开」。移动文件夹或拔出移动盘前，运行 Stop DSH-Portable.command。

Linux：从完整便携目录运行 ./DeepSeek-Herness；AppImage 首次使用前执行 chmod +x。
AppImage 数据保存在同目录的 DSH-Portable-data，迁移时请把两者一起复制。

启动器会先询问再安装更新。普通更新只下载变化的 DSH 应用组件；会话、设置、
凭据和工作区都会保留。Windows 遇到兼容性变化时会下载完整版本并原地更新，
不会覆盖 data 与 workspace；新版启动失败会恢复旧版。

Windows 与 Linux 托盘、macOS 应用菜单都可手动检查更新。自动检查默认关闭。
更新不会中断正在运行的任务。

遇到启动慢或启动失败时，在「设置 → 通用设置 → 便携版」导出脱敏支持报告。
报告包含最近两次启动的完整分段轨迹；请优先提供报告，不要直接发送可能含令牌的原始日志。

Windows 可双击 dsh.exe 或从托盘「更多」中打开 DSH 终端；macOS 和 Linux 可从
应用菜单或托盘打开 DSH 终端。插件提供的官方命令可以原样粘贴：

  dsh plugin --profile web add <插件>
  dsh plugin --profile web list --depth 0
  dsh plugin --profile web update <插件包名>
  dsh plugin --profile web remove <插件包名>
  dsh --profile web --dump-config

DSH 终端不会修改系统 PATH。移动整个便携文件夹后，新窗口会自动使用新位置。
插件变更不会自动重启 DSH；请保存任务，在方便时退出并重新打开。

Linux 没有可用的图形终端时，也可以在便携目录运行 ./dsh。

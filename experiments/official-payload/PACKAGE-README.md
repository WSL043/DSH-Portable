# DSH-Portable 1.0.0-alpha.3

Windows x64 开发构建，只保留为草稿。解压到全新目录，运行 **DeepSeek Harness Portable.exe**。不要覆盖旧版或导入旧 data。

Windows x64 development draft. Extract into a fresh directory and run **DeepSeek Harness Portable.exe**. Do not overwrite earlier versions or import their data.

## 便携边界 / Portable boundary

官方 EXE 和运行库保留原字节；官方 app.asar 的主进程增加协议、更新传输和首次默认插件初始化三处边界适配，插件管理客户端增加官方「插件」页工具栏的市场扩展点。市场的安装操作进入官方安装窗口。修改前后摘要与适配协议版本记录在 launcher/provenance.json 和 resources/portable-adaptation.json。不能把此版描述为完全未经修改的官方程序。

Official executable and runtimes remain unchanged. The ASAR main process adapts protocol registration, update transport and first-profile default plugin initialization. Original and adapted hashes are recorded. This is a community-adapted desktop, not an unmodified official distribution.

## 默认插件 / Default plugins

新目录只默认启用会话管理 `dsh-chat-manager` 与插件市场 `@wsl043/dsh-portable-plugin-market`。不再内置图片查看器。两款都是官方插件管理页可以关闭、卸载的普通插件；完成首次初始化后，重启和更新不会恢复已卸载或已关闭的插件。现有 profile 不强行补装。首次初始化使用随包离线依赖，不要求网络。

Only Chat Manager and Portable Plugin Market are enabled in a fresh profile. Image Viewer is not bundled. Both use ordinary official plugin controls; disabling or uninstalling them persists across restarts and updates. Existing profiles are preserved. Initial provisioning uses bundled offline dependencies.

市场负责浏览、截图、搜索、分类与下载统计；安装通过官方 pluginManager 服务执行，安装后在官方详情页决定是否启用。需要手动重新安装时，可在官方“添加插件”中填写 `launcher/default-plugins` 下对应插件目录的完整路径。

The market handles discovery; official pluginManager owns installation and activation. Enable newly installed packages from their official detail page. To reinstall a removed default, add its absolute directory path under launcher/default-plugins through the official Add Plugin dialog.

## 使用和更新 / Use and updates

- 所有正常启动、dsh:// 回跳、更新重启都经便携入口进入同一数据目录。内部 EXE 被直接启动时转回启动器。
- 官方更新界面负责检查、确认、任务停止和进度呈现；Portable 负责下载已验收的官方版本、验签、应用边界适配、暂存和冷启动切换。不运行官方安装器。
- 保留当前、上一及待切换程序；程序保留不表示用户数据能够降级。失败诊断在 data/launcher。
- 应用状态、插件和受管缓存放在 data。完全退出后移动整个目录。

Protocol return, normal launch and update restart use the same portable entry. The official update coordinator retains its UI and task shutdown policy while Portable authenticates, adapts, stages and activates qualified desktop payloads without running the installer. Application state and managed caches live under data. Move the entire folder only after a full exit; program retention is not data downgrade support.

## 边界 / Limitations

工作区文件仍沿用官方外部路径，包括系统文档中的默认工作区；搬迁不自动移动项目或重写旧会话绝对路径。官方固定端口 19387 仍不能与另一份安装同时使用。dsh:// 是系统级关联，指向最近注册的便携入口，移动后需先重新运行启动器。Windows 临时文件、系统记录、拼写组件缓存仍可能在外部。

Workspace files remain external. Moving Portable does not move projects or rewrite historical absolute paths. Port 19387 remains exclusive. The dsh:// association points to the last registered portable entry; launch it once after relocation. Windows system records, temporary files and shared spelling caches may remain outside the folder.

不承诺旧数据迁移、跨机器免登录、全部第三方插件或完整断电恢复。data 可能包含明文凭据，不要公开分享。启动器未签名；官方 EXE 签名不代表官方认可此社区发行包。完整通过项目以随包 qualification.json 为准，开发草稿不等于正式版验收。

Legacy migration, cross-machine login persistence, every third-party plugin and full power-loss recovery are not guaranteed. Never share credential-bearing data. The community launcher is unsigned; the official EXE signature does not endorse the whole distribution. Qualification scope is recorded separately.

## 许可 / Licenses

保留官方第三方许可；7-Zip 许可在 launcher/License.txt，源码与项目：https://www.7-zip.org/ 。项目与反馈：https://github.com/WSL043/DSH-Portable 。

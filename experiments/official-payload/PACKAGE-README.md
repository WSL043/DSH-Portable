# DSH-Portable 1.0.0-alpha.3

Windows x64 开发构建，只保留为草稿。解压到全新目录，运行 **DeepSeek Harness Portable.exe**。不要覆盖旧版或导入旧 data。

Windows x64 development draft. Extract into a fresh directory and run **DeepSeek Harness Portable.exe**. Do not overwrite earlier versions or import their data.

## 便携边界 / Portable boundary

官方 EXE 和运行库保留原字节；官方 app.asar 的主进程增加两处边界适配：协议注册指向便携启动器；更新协调器接入便携更新传输。修改前后摘要与适配协议版本记录在 launcher/provenance.json 和 resources/portable-adaptation.json。不能把此版描述为完全未经修改的官方程序。

Official executable and runtimes remain unchanged. The ASAR main process has two audited adaptations: portable protocol registration and an external update transport for the official coordinator. Original and adapted hashes are recorded. This is a community-adapted desktop, not an unmodified official distribution.

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
# DSH-Portable 1.0.0-alpha.2

Windows x64 实验版 / Experimental preview. 请解压到全新文件夹，运行 **DeepSeek Harness Portable.exe**。不要覆盖 0.7.x 或 alpha.1，也不要导入它们的 data。

Extract into a fresh folder and run **DeepSeek Harness Portable.exe**. Do not overwrite 0.7.x/alpha.1 or import their data.

## 本次路线 / Architecture

使用未经修改的官方 DeepSeek Harness EXE、app.asar 和运行库。Portable 仅提供外置启动器、应用数据路径、受管依赖搬迁和程序更新。仅不部署官方的 `resources/app-update.yml`，避免运行安装器把便携版变成安装版。官方文件的签名不代表社区便携包得到官方认可；我们的启动器没有官方签名。

Official executable, ASAR and runtimes remain unchanged. Portable owns only the external launcher, application data paths, managed dependency relocation and application updates. The installer updater configuration is omitted. Official file signatures do not endorse this community distribution; the launcher is not signed by DeepSeek.

## 使用与更新 / Use and updates

- 完全退出后，可以移动整个文件夹；应用状态、插件和受管缓存保存在 `data` 中。不会重定向整个 Windows 用户目录。
- 启动器后台检查已通过便携验收的官方桌面版本，从官方下载并校验原始安装包，准备成功后在下次完全退出并启动时切换。检查失败不阻止现有版本启动。最新结果在 `data/launcher/update-status.json`。
- 更新按官方整套桌面交付，不支持把另一版本内核单独塞进 Electron。保留当前版本和上一程序版本；程序回退不等于用户数据格式回退。
- **官方应用内“检查更新”会显示更新源错误，这是本 Alpha 的已知差异。** 请使用 Portable 启动器；它不会调用官方安装器。

After a full exit, move the entire directory. Application state, plugins and managed caches live under `data`. The launcher checks a small catalog of qualified official desktop artifacts, verifies and stages them in the background, and activates a prepared version on a subsequent cold launch. Check failures do not block the existing application. The official in-app update command reports an unavailable update source in this preview. Updates replace the entire desktop, not an independently selected core. Retaining an older program does not reverse data migrations.

## 重要边界 / Known boundaries

- **工作区文件是外部资料，不会自动装进便携目录。** 官方默认工作区仍在系统“文档/deepseek-harness/default-workspace”；自选项目路径也沿用官方行为。搬机器时需要自行搬运项目文件、重新选择路径。此版本不承诺会话中的旧绝对路径自动重定位。
- 官方程序会注册 `dsh://` 协议，可能覆盖安装版关联；通过协议或直接运行内部官方 EXE 会绕过启动器。此问题尚需上游扩展接口。建议在实验环境试用，不与安装版混用。
- 官方宿主使用固定端口 19387。另一份桌面占用时，启动器会提示先退出它。
- Windows 仍可能写系统运行记录、拼写词典、临时文件及系统组件缓存。这不是“零痕迹”沙箱。
- 账号、密钥可能以明文保存在官方数据文件中。不要公开分享 `data`。换电脑可能需要重新登录；跨机器账号、旧版迁移和所有第三方插件不属于本 Alpha 的完整验收承诺。

Workspace files remain external, including the official default under Documents. Moving the application does not migrate workspace files or rewrite old absolute paths in sessions. The official app registers `dsh://`, potentially replacing an installed edition's association; protocol launches and directly running its internal EXE bypass the portable launcher. Port 19387 is shared, so exit another desktop instance first. Windows system records, spelling dictionaries, temporary files and component caches may remain outside the portable folder. This is not a zero-trace sandbox. Credentials may be stored in plaintext; never share `data` publicly. Cross-machine authentication may require signing in again.

## 来源与许可 / Provenance and licenses

官方程序来源及摘要见 `launcher/provenance.json`。随包保留官方第三方许可文件；启动器使用的 7-Zip 许可见 `launcher/License.txt`，项目与源码：[7-zip.org](https://www.7-zip.org/)。

Official artifact identity is recorded in `launcher/provenance.json`. Original third-party notices are retained. The extraction tool's license is in `launcher/License.txt`; see [7-Zip](https://www.7-zip.org/) for its project and source.

[项目与反馈 / Project and feedback](https://github.com/WSL043/DSH-Portable)

# 纯便携版通道运维

## 自动化边界

- `official-desktop-channel.yml` 每小时读取官方 feed；版本和摘要已在索引中时不运行 Windows 验收。
- 新身份先验证官方安装包大小、SHA-512、Authenticode 发布者及 NSIS 展开，再依次通过阶段 1 更新契约哨兵和阶段 2 的真实旧版到新版升级验收。
- 仅两个门槛都报告 `overallPassed: true` 才生成并发布索引、`nightly.yml` 与启动器副本。用户仍从官方更新界面升级，程序下载官方安装包。
- `official-pure-alpha.yml` 只在手动 dispatch 后打包、解压冒烟并更新 `v1.0.0-alpha.4` 草稿；不会替代稳定 Native 线。
- alpha.4 随包预装 `dsh-image-viewer@0.1.5` 与 `dsh-chat-manager@1.5.4`，两个插件默认关闭。源码仓库与固定提交、期望版本集中在 `.github/workflows/official-pure-alpha.yml` 顶部 `env`；升级时同步更新对应的 `*_COMMIT` 与 `*_VERSION`，工作流会断言各自 `package.json` 版本，并按插件 CI 的构建/打包步骤生成 tgz。
- alpha.4 的 CI 冒烟要求首次启动成功、第二次启动完成两个插件播种并保持健康，之后用官方 `--dump-config` 检查关闭状态及整根搬动后的相对路径。配置和本地证据不等于 GitHub Windows runner 验收；CI 运行前不宣称通过。
- 这些工作流目前等待 GitHub Windows runner 首次验证；配置存在不代表阶段 3 已验收。

## 完整包与轻量包

- 完整包保留已展开的 `app/<版本>/`，适合离线复制；新增的 `-Bootstrap` 轻量包省略官方桌面与 `current.json`，携带启动器、更新引擎、`follow.json`、`bootstrap.json`、7-Zip 和同一组可选插件种子。CI 必须断言无应用版本目录、无 `current.json`，并检查解压后体积小于 40 MiB。
- 首次启动使用生产 `follow.json` 的索引选出最新已验收版本，再从官方 `download.deepseek.com` 下载。下载状态位于 `data/launcher/update-status.json`；`.part` 文件仅按 HTTP Range 续传，Range 不受支持时从头开始，SHA-512 或大小错误时丢弃部分文件。离线机器应使用完整包。
- Windows CI 的轻量冒烟必须实际完成首次安装、官方页面渲染与正常退出，再运行第二次启动插件播种、disabled `--dump-config` 和搬根检查。静态检查、下载接受或绿色的非真实 runner 任务都不构成官方成品验收。
- Bootstrap 标记在成功安装后保留；后续启动只检查 `current.json` 与应用文件是否完整，已安装根按原路径启动，不弹安装窗口。

## 需要人工介入的情况

- 更新契约哨兵或完整 E2E 失败；检查对应 workflow artifact 和运行日志。
- 收到 `Official desktop <version> did not qualify` issue；同版本后续失败会评论到原 issue。
- 官方改变 feed、NSIS 文件布局、`app-update.yml`、签名发布者、数据目录语义或更新器调用形状。通道不会因验收失败而前进。
- 发现同版本官方安装包摘要/大小改变时，停止发布并由维护者核查，不得覆盖旧身份。

## 冻结、回退与撤回

紧急冻结：删除更新 feed 资产，现有客户端不会看到新的通道版本：

```powershell
gh release delete-asset update-channel-desktop nightly.yml --yes
```

恢复或回退最新一个版本：先下载索引，再移除最高版本并选出剩余最新版本（要求至少两条）：

```powershell
New-Item -ItemType Directory -Force build/orch-080/channel-rollback | Out-Null
gh release download update-channel-desktop --pattern index.json --dir build/orch-080/channel-rollback
node --input-type=module -e "import fs from 'node:fs';const d='build/orch-080/channel-rollback/';const i=JSON.parse(fs.readFileSync(d+'index.json','utf8'));if(i.versions.length<2)throw Error('no rollback version');i.versions.pop();fs.writeFileSync(d+'index.json',JSON.stringify(i,null,2)+'\n');fs.writeFileSync(d+'candidate.json',JSON.stringify(i.versions.at(-1),null,2)+'\n')"
$v = node -p "JSON.parse(require('fs').readFileSync('build/orch-080/channel-rollback/candidate.json','utf8')).version"
gh release download update-channel-desktop --pattern "deepseek-harness-$v-win-x64.exe" --dir build/orch-080/channel-rollback
node experiments/official-payload/channel/build-channel.mjs --index build/orch-080/channel-rollback/index.json --candidate build/orch-080/channel-rollback/candidate.json --launcher "build/orch-080/channel-rollback/deepseek-harness-$v-win-x64.exe" --output build/orch-080/channel-rollback/generated
node scripts/upload-release-assets.mjs update-channel-desktop build/orch-080/channel-rollback/generated/index.json build/orch-080/channel-rollback/generated/nightly.yml --mutable
```

撤回任意一个已发布版本（示例 `0.2.0-rc.3`）：

```powershell
$env:RETRACT_VERSION = '0.2.0-rc.3'
node --input-type=module -e "import fs from 'node:fs';const d='build/orch-080/channel-rollback/';const i=JSON.parse(fs.readFileSync(d+'index.json','utf8'));const n=i.versions.length;i.versions=i.versions.filter(x=>x.version!==process.env.RETRACT_VERSION);if(i.versions.length===n||!i.versions.length)throw Error('version absent or no rollback target');fs.writeFileSync(d+'index.json',JSON.stringify(i,null,2)+'\n');fs.writeFileSync(d+'candidate.json',JSON.stringify(i.versions.at(-1),null,2)+'\n')"
$v = node -p "JSON.parse(require('fs').readFileSync('build/orch-080/channel-rollback/candidate.json','utf8')).version"
gh release download update-channel-desktop --pattern "deepseek-harness-$v-win-x64.exe" --dir build/orch-080/channel-rollback
node experiments/official-payload/channel/build-channel.mjs --index build/orch-080/channel-rollback/index.json --candidate build/orch-080/channel-rollback/candidate.json --launcher "build/orch-080/channel-rollback/deepseek-harness-$v-win-x64.exe" --output build/orch-080/channel-rollback/generated
node scripts/upload-release-assets.mjs update-channel-desktop build/orch-080/channel-rollback/generated/index.json build/orch-080/channel-rollback/generated/nightly.yml --mutable
```

## 启动器与用户机器边界

- 只在修复启动、更新、回退、协议转交缺陷或官方契约变化时发布新启动器；普通官方桌面版本由通道自动复用当前启动器跟进。
- 便携根目录外的已知写入只有 `%LOCALAPPDATA%\<updaterCacheDirName>\pending`（官方更新器保存的启动器副本/缓存）以及当前用户 `HKCU\Software\Classes\dsh\shell\open\command`（运行期间临时接管，退出还原）。应用数据、下载暂存、日志与版本目录在便携根目录。
- 官方固定端口 `19387` 不允许已安装版、另一 Portable 实例同时运行；启动器只提示，不结束其他进程。`dsh://` 由运行中的启动器接管并在退出时恢复。
- 当前实现仍待 GitHub CI 的安装包下载/验签/展开、完整双阶段验收、Release 回读及 alpha.4 解压冒烟；不得据此声称架构或通道已验收。

# 纯便携架构：官方桌面端零改动，全自动跟进

2026-09-29 设计，依据同日在官方 `0.2.0-rc.2` 真实安装包上的实验（见文末「实验证据」）。这是 1.0 开发线（`experiments/official-payload/`）的架构基准；具体实现分阶段验收，未验收的部分不得写成已完成。

## 目标与不变量

用户要求：Portable 只做便携化，官方桌面端所有能力保持；不预装插件、不带市场；官方发新版后自动跟进，我们维护最少，官方更新时 Portable 本身不必发版。

不变量（任何实现都不得违反，违反即回退设计）：

1. **官方代码字节不改。** `DeepSeek Harness.exe`、`app.asar`、运行库、内置运行时保持安装包原样。唯一允许的差异是 `resources/app-update.yml` 这个**配置文件**的内容（官方更新库定义的更新源配置）。
2. **官方自己的更新流程保持工作。** 官方有服务端下发的“强制更新”机制（`dshMandatoryUpdatePolicy`，向 `harness.deepseek.com` 查询，阻塞界面并调用同一个更新协调器）。若关掉更新流程，用户会卡在一个没有可用按钮的阻塞窗口里。所以不能删除 `app-update.yml`，必须让流程走通。
3. **用户数据只在便携目录。** 数据根由官方支持的环境变量 `DSH_HOME` 与 Chromium 开关 `--user-data-dir` 指定，不依赖任何补丁。
4. **失败时保持现状。** 任何一步验证失败，用户停留在当前可用版本，绝不半更新。
5. **我们只承担已被测试守住的契约。** 每个依赖的官方行为都有对应的自动检查（见「契约与哨兵」），官方改了会先在我们的 CI 变红，而不是先在用户机器上出问题。

## 分层

| 层 | 内容 | 谁改它 |
| --- | --- | --- |
| L0 官方成品 | `app/<版本>/` 下由官方 NSIS 安装包解出的完整目录 | 只由“更新”写入，永不手改 |
| L1 便携启动器 | 一个小型原生程序：启动官方程序（设置数据位置）、监督、**兼任更新应用器**、健康检查与回退 | 很少改；官方变更契约时才改 |
| L2 通道 | 我们发布的静态更新源（GitHub Releases/Pages）：`nightly.yml` 格式，只列**通过验收的**官方版本；每个条目指向启动器副本 | 全自动生成 |
| L3 验收 | 每小时监控官方发布；在一次性 Windows 环境用真实安装包跑隔离启动、边界记录、更新契约哨兵 | 全自动，红了才需要人 |

目录（示意）：`Portable根/`{`DeepSeek Harness Portable.exe`（L1）、`app/<版本>/`（L0，保留当前+上一版）、`app/current.json`、`data/dsh-home/`（`DSH_HOME`）、`data/electron/`（`--user-data-dir`）、`launcher/`（配置、收据、7z、日志）}。

## 更新数据流（保留官方弹窗，更新动作由 Portable 完成）

1. `app-update.yml` 改为：`provider: generic`，`url` 指向 L2，`channel` 与官方一致，**去掉 `publisherName`**，`updaterCacheDirName` 用便携专用名。（官方更新库在 `publisherName` 缺省时跳过安装包签名校验：`NsisUpdater.verifySignature` 返回 null。）
2. 官方应用自己检查更新、自己下载、自己弹“新版本 X 已准备就绪”，与官方体验一致。
3. L2 的每个条目是“版本 X”，其 `url` 指向**启动器副本**（体积很小，`sha512` 固定）。官方把它当安装包下载。
4. 用户点“安装并重启”，官方调用 `quitAndInstall(true, true)`，实际执行：`<缓存>\pending\deepseek-harness-<X>-win-x64.exe --updated /S --force-run`，然后退出。执行的就是我们的启动器副本。
5. 启动器识别 `--updated`，从文件名得到 X，向 L2 查出**真正的官方安装包**（官方 CDN 地址、sha512、大小），下载、校验 sha512、校验 Authenticode 有效且发布者为 `Hangzhou DeepSeek Artificial Intelligence Co., Ltd.`，安全解包到 `app/<X>/`，重写 `app-update.yml`，等旧进程退出，原子切换 `current.json`，重启（`--force-run` 语义）。
6. 新版首次启动 20 秒内异常退出 → 自动改回上一版重启一次，写状态；不做第二次尝试。
7. 启动器副本比已安装启动器新时，顺带自更新启动器。启动器因此也走同一条官方更新通路，无需第二套机制。

强制更新窗口走同一个协调器，天然可用。

## 关键风险与处理

| 风险 | 处理 |
| --- | --- |
| **`dsh://` 协议**：官方应用每次启动都把 `dsh://` 注册到自己的 exe（实验证实）。点击链接会直接启动官方 exe，绕过启动器，得到系统默认数据位置，并因固定端口 `19387` 与运行中的实例冲突（实验中已复现该错误框） | 启动器驻留期间接管 `HKCU\Software\Classes\dsh` 命令为“启动器 + 链接”，由启动器带正确环境转交给运行中的官方实例或启动它；退出时还原。文档如实说明这是启动器写入的系统项 |
| **固定端口 19387**：官方主机监听固定端口，同机不能同时运行两个官方实例（含已安装的官方版） | 启动前检测并给出明确提示；不去改端口（那需要改官方行为） |
| **官方对便携目录外的写入**：`%LOCALAPPDATA%\<updaterCacheDirName>\pending`（仅启动器副本，几 MB）、注册表 `dsh` 协议 | 验收每次记录目录外写入清单；白名单外判失败；不承诺“零写入” |
| **官方强制更新领先于我们的验收** | 验收在官方发布后一小时内完成；失败时停在当前版并告警。是否提供“跳过验收”的应急开关，作为待决问题，默认不提供 |
| **官方改了安装包结构、feed 格式、更新协调器参数、`DSH_HOME` 语义** | 契约哨兵先红，L2 冻结在最后一个通过版本，用户不受影响；只有此时才需要人 |
| **回退与数据**：官方升级可能迁移 `DSH_HOME`，旧二进制未必读得回 | 回退只用于“新版没能启动”这一情形（迁移之前）；不承诺跨版本降级 |
| **无签名启动器副本被杀软误报** | 可复现构建 + 发布校验值；签名走既有 SignPath 申请（`CODE_SIGNING.md`），作为独立事项 |

## 契约与哨兵（每个都有自动检查）

1. 官方 feed 是 `electron-updater` generic 格式；2. 安装包是可用 7z 解开的 NSIS，目录布局稳定，含 `resources/app-update.yml`；3. 更新库调用形状为 `installer --updated /S --force-run`，缓存目录由 `updaterCacheDirName` 决定；4. `DSH_HOME` 与 `--user-data-dir` 生效，`app.asar` 未硬编码路径；5. 安装包 Authenticode 有效、发布者不变；6. `dshMandatoryUpdatePolicy` 阻塞窗口仍调用协调器。

**更新契约哨兵**就是本设计的实验，脚本化后每次官方新版都自动重跑：本地假 feed → 启动官方程序 → 出现更新弹窗 → 点“安装并重启” → 断言执行的正是启动器副本且参数如上 → 断言官方进程退出。

## 体积

官方安装包 289,313,640 B（约 276 MiB）；解出约 1.0 GiB / 9,764 个文件。更新期间当前版 + 上一版同存，短时约 2 GiB；新版成功启动后清理上一版（可选用 NTFS 硬链接让重复文件只占一份，作为后续优化）。这是完整官方桌面，不做任何删减。

## 不在范围

macOS：官方有桌面端，同架构可移植，另立阶段。Linux：官方无桌面端，继续由稳定版 Native 线交付。稳定版 0.x 在纯便携版验收通过前照常维护。

## 阶段与门槛

1. **契约与哨兵**：把下面的实验做成可重复的脚本与 CI（假 feed、启动器副本桩、断言）。门槛：在真实 `0.2.0-rc.2` 上通过。
2. **启动器**：启动、监督、`--updated` 应用、回退、协议接管。门槛：单元与集成测试，隔离目录内端到端更新一次。
3. **通道生成**：每小时监控 → 验收 → 生成 L2 → 发布；失败冻结并告警。门槛：连续多次官方版本自动跟进。
4. **发布 alpha.4**：草稿；不替代稳定版。

### 阶段 1 状态（2026-09-29）

- 已实现本地假 generic feed、C# 更新器桩、静态 ASAR/electron-updater 契约检查与 CDP 鼠标交互探针。
- 已实现请求/调用日志、逐项 JSON 报告、协议快照还原及探针缓存/工作副本清理。
- 已添加离线单测和每小时/手动 Windows workflow；成功探针按版本与 SHA-512 缓存。
- 尚未在真实 `0.2.0-rc.2` 上完成本地动态验收：当前已有官方进程占用固定端口，按规则不终止。
- 尚待 workflow 在 Windows runner 上验证安装包展开、完整动态哨兵和 artifact 证据。
- 因此阶段 1 **未验收**，不表示架构门槛已通过。

## 实验证据（2026-09-29，本机，`build/orch-080/E/`，未入库）

- 安装包 `deepseek-harness-0.2.0-rc.2-win-x64.exe`：289,313,640 B，SHA-512 与官方 feed 一致，Authenticode 有效，发布者为杭州深度求索。
- 官方 NSIS 安装器**忽略 `/D=`**，固定装到 `%LOCALAPPDATA%\Programs\DeepSeek Harness`，写入卸载项、开始菜单与桌面快捷方式，并在安装后自动启动；因此便携化必须走“解包”而不是“静默安装”。
- `resources/app-update.yml`：`provider: generic`、官方 feed 地址、`channel: nightly`、`updaterCacheDirName`、`publisherName`。
- 更新协调器构造：`autoDownload=false`、`allowPrerelease=true`、`allowDowngrade=false`；仅在打包且存在 `app-update.yml` 时启用；`install()` 调用 `quitAndInstall(true, true)`。
- 拷贝一份官方目录，改写 `app-update.yml`（本机 http feed，无 `publisherName`），设置 `DSH_HOME` 与 `--user-data-dir` 启动：应用请求了 `nightly.yml`，随后下载（同时请求了 `.blockmap`，404 被正常忽略）“安装包”，界面出现官方更新弹窗“新版本 0.2.0-rc.3 已准备就绪 / 安装并重启”，点击后官方执行 `...\pending\deepseek-harness-0.2.0-rc.3-win-x64.exe --updated /S --force-run` 并退出。桩程序确认了完整参数。
- 数据隔离：`--user-data-dir` 生效（Electron 数据约 9 MB 落在指定目录）。运行中的官方应用把 `HKCU\Software\Classes\dsh` 注册到**自己所在的 exe 路径**。
- 第二个官方实例因端口 `19387` 被占用而启动失败（`EADDRINUSE`，错误框“另一个 DSH 实例正在运行”）。

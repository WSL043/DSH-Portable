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

### 阶段 2 状态（2026-09-30）

- 已实现纯模式 C# 启动/监督、20 秒健康门、单次回退、dsh:// 临时接管，以及官方更新副本入口。
- 已实现官方索引/安装包校验、安全解包、仅改写 app-update.yml、版本切换/收据/清理引擎与纯布局打包脚本。
- 状态转移抽为 `launcher/state.mjs`，便于离线 Node 测试；交付仍以 C# 为准，并用源码合约测试锁定相同的健康/回退谓词。
- 离线状态、URL 白名单、配置改写、安全路径及纯打包边界测试通过；C# 编译通过，详见 `build/orch-080/T25/` 本机证据。
- 本机 E2E 未启动：已安装官方进程 6 个且端口 19387 被 PID 43560 占用；指定的 `E/official.exe`、`E/exp/app` 与 7-Zip 均不可用。未结束任何进程；详见 `e2e-preflight.json`。
- 因此真实更新弹窗/副本交接、安装包解包与校验、20 秒健康清除、崩溃回退、协议还原及目录外写入清单仍待有可用隔离 Windows runner 时验证。
- 通道自动生成、周期验收和发布仍属于阶段 3；当前状态不表示架构门槛已通过。

### 阶段 2 验收（T27，计划）

- 端到端覆盖真实官方 `0.1.7-rc.2` → feed 最新官方候选：官方更新弹窗、启动器副本交接、下载验签/解包、版本切换、重启健康门与崩溃回退。
- 同时记录便携数据路径、`app-update.yml`、协议键还原、版本保留和根目录外写入。
- 仅在干净的 GitHub-hosted Windows runner 运行；工作流为 `.github/workflows/official-pure-e2e.yml`，证据保留 14 天。
- 脚本、报告汇总和纯逻辑测试已编写；真实官方成品完整链路**尚未运行**，阶段 2 验收状态未判定。

### 阶段 3 状态（2026-09-30，T28）

- 已编写离线通道生成器、semver 排序与 20 条保留规则、固定生产 URL 常量，以及针对索引、`nightly.yml` 与启动器文件名契约的 Node 测试。
- 已编写每小时候选发现→Windows 契约与真实升级双门槛→受控 Release 上传/回读流水线；不合格时不进入发布 job，并按版本创建或评论 issue。
- 已把官方安装包下载、大小/SHA-512/Authenticode 校验及 NSIS 展开抽为共享 action，并由原有两个官方验收 workflow 复用。
- 已编写手动 alpha.4 生产通道打包、解压后启动冒烟与草稿 Release 流水线，以及中文运维文档。
- 本地源码/静态检查不等于 GitHub Windows runner 的真实官方成品验收；工作流尚未运行、通道 Release 未修改、alpha.4 草稿未创建，连续多次自动跟进仍待 CI 证据。因此阶段 3 **未验收**，纯便携架构也未因此宣告通过。

### 预装默认插件（开发线）

- 可选随包携带已审阅的插件 `.tgz` 与 `launcher/seed/seed.json`；不传种子参数时打包行为保持不变。
- alpha.4 包含 `dsh-image-viewer@0.1.5` 与 `dsh-chat-manager@1.5.4` 两个预装插件，均默认关闭。两个源码仓库、固定提交 SHA 与期望版本常量位于 `.github/workflows/official-pure-alpha.yml` 顶部 `env`；升级插件时同步更新对应 `*_COMMIT` 和 `*_VERSION`，并保留工作流的 `package.json` 版本断言。
- alpha.4 Windows CI 会沿用插件仓库的安装、行为测试、构建及 `pnpm pack` 流程生成种子包；冒烟覆盖第一次启动、第二次启动播种和健康检查、`probe` profile 的 disabled dump，以及整根搬动后的再次 dump。该工作流尚待 runner 执行，本地脚本和静态测试不构成 CI 验收。
- 启动器只在官方 `desktop` profile 已存在、未记录该插件且无官方进程时，在启动官方应用前调用官方 `dsh.cmd plugin add`。
- 首次启动创建 profile，因此预装插件在第二次启动前播种；这是预期时序。
- 官方 `plugin add` 自动将包名加入 `dsh.profile.bundles`；种子脚本不手改 bundles。归档保留在 profile 的 `seed/`，依赖及 `pnpm-lock.yaml` specifier 使用 `file:./seed/...`，`.modules.yaml` 的虚拟存储路径为相对 `.pnpm`；patch 条目默认 `disabled: true`。
- 播种校验 SHA-512；单插件失败回滚其 profile/patch/`node_modules` 改动并记状态，失败不阻断官方应用启动。
- 2026-09-30 已用两个真实插件包和官方 rc.2 `dsh.cmd` 验证播种；复制为 `probe` 后 `--dump-config` 两条均为 disabled，整根移动后重复通过，移动后再用官方命令添加另一包也成功。
- 启动器第二次启动确实完成播种、官方界面显示两个插件关闭，仍待主管真机验证；本机 CLI 验收未启动官方应用。

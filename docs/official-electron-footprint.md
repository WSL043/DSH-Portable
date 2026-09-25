# 官方 Electron Desktop 的体积边界与分发方案

2026-09-26 实测。这里的 Windows 实物是官方 `0.1.7-rc.2` Nightly 安装器；Portable 同代数据来自[精确候选构建](https://github.com/WSL043/DSH-Portable/actions/runs/36067985239)的 footprint 报告。它们锁定同一 DSH 版本，但组件布局、压缩方式和启动边界不同，不能把两者差额全归因于 Electron。

## 同代发行物

| Windows x64 | 压缩下载体积 | 展开文件总长度 | 含义 |
| --- | ---: | ---: | --- |
| Portable RC2 候选标准 ZIP | 125,590,239 B / 119.8 MiB | 448,403,979 B / 427.6 MiB | CI footprint；其中运行时胶囊仍为压缩文件，不等于首次启动后的占盘量 |
| 官方 Desktop RC2 安装器 | 288,245,480 B / 274.9 MiB | 1,058,538,220 B / 1009.5 MiB | [官方 Nightly feed](https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml)；解出的 9,764 个文件，不等于实际安装后的磁盘占用 |

官方 macOS arm64 RC2 [更新 ZIP](https://download.deepseek.com/dsh-desk/feeds/mac-arm64/nightly-mac.yml)为 372,794,444 B / 355.5 MiB；同代 Portable 候选 ZIP 为 158,802,311 B / 151.4 MiB。没有 macOS 主机上的重打包、解压或签名验收，因此不能套用下面的 Windows 7z 结果。正式版 `v0.7.4` 的 Windows 标准/完整离线 ZIP 分别为 146.0/416.1 MiB，但内核版本不同，只能作为用户目前下载量的参照。

## Windows 安装器占用在哪里

从签名安装器的 7z 目录按路径统计；压缩列不含约 1.3 MB 的安装器容器、签名与目录开销。下载文件的 SHA-512 与官方 feed 一致，安装器和解出的主 EXE 的 Authenticode 均为 `Valid`。

| 类别 | 展开 | 安装器内压缩 |
| --- | ---: | ---: |
| Electron/Chromium 根文件 | 333.0 MB | 110.1 MB |
| Primary Runtime（Python、Node、pnpm） | 285.3 MB | 74.5 MB |
| ASAR 外的 DSH 原生依赖 | 253.0 MB | 67.7 MB |
| `app.asar` | 117.4 MB | 21.6 MB |
| Electron 语言资源 | 50.6 MB | 9.0 MB |
| 另附的 pnpm | 18.7 MB | 3.9 MB |

其中官方 LibreOffice 原生包已占 190.9 MB 展开 / 50.0 MB 压缩，Portable 同代包也包含约 190.9 MB 的这个包；把整个差额说成 Office 或 Electron 单项都不准确。官方 Primary Runtime 的 Python 树约 172.9 MB 展开 / 46.3 MB 压缩，独立 Node 约 93.7 MB / 24.4 MB。两处 pnpm 的 `dist/pnpm.mjs` 字节哈希相同，但它们处于不同的官方运行时契约；只凭重复不能安全删一处。官方构建已经过滤声明文件、已识别 source map、测试目录和无关平台的部分原生文件；继续盲删可能破坏功能或签名。

## 不删功能的压缩试验

同一份解出的官方 Windows 文件，使用 7-Zip 21.07 x64 重打包。两个重打包文件的完整归档测试通过；重新解出的主 EXE 哈希与原件一致，签名仍为 `Valid`。这仅验证字节与压缩，不证明更新器和目录迁移可用。

| 格式 | 文件大小 | 压缩耗时 | 解出 9,764 个文件 |
| --- | ---: | ---: | ---: |
| 官方 NSIS 安装器，内部非 solid LZMA2 | 288,245,480 B / 274.9 MiB | 上游构建，未测 | 约 17 秒（单次提取） |
| 普通 ZIP，Deflate 等级 7 | 372,772,449 B / 355.5 MiB | 46.1 秒 | 15.7 秒 |
| solid 7z，等级 7 | 251,479,563 B / 239.8 MiB | 74.7 秒 | 14.3 秒 |

solid 7z 比官方安装器小 12.8%，比普通 ZIP 小 32.5%；这台机器上的两次解压时间接近，**不能**推出所有机器首启更快。首屏还要叠加运行时准备、插件和工作台加载；solid 包仍需一个用户无需另装 7-Zip 的可信提取入口。重压缩不会把 Electron 降到同代原生标准 ZIP 的 119.8 MiB：它仍约为两倍，展开程序文件约 1 GB。

## 产品决策与验收线

1. 现有 Native 标准 ZIP 继续作为轻量默认选项，完整离线包服务没有 WebView2 的断网 Windows；Linux 仍由 Native 交付。Electron 在数据搬迁、断网、插件、更新和回退通过前只作为独立试验通道，不能用一张体积表替代产品验收。
2. Windows Electron 试验通道优先验证**完整文件一次性 solid 压缩、一次性解包到带版本号的程序目录，用户数据独立存放**。此 RC2 的文件净载荷约 239.8 MiB；引导程序、清单和签名会让实际下载略大。每次普通启动不重复解包；更新只切换通过校验的新版本，并保留可回退的旧版本。首次可用时间必须从下载后首次打开算到工作台可操作，与现有 Native 实测比较。
3. 官方 Desktop 当前自带整套更新器，签名发行物不能在事后改更新逻辑。便携版必须先确定**唯一更新所有者**和受支持的便携数据根：最好由上游提供便携模式/构建开关；否则从固定官方源码构建自己的完整 Electron 发行物并由自己的签名和更新链负责。不能把官方签名安装器外包一层就宣称完成便携化。
4. 真正的大幅瘦身需让上游明确区分核心启动必需文件与 Office/Python 等按需能力，提供可校验、可离线预装的组件契约，然后再量化精简版与完整离线版。未得到该契约前，不从官方包中手工摘除 Python、Node、原生库、语言资源或许可证。仅删除重复 pnpm 的理论上限也只有数 MiB，不值得为此增加难以维护的补丁。
5. 后续每次候选构建记录压缩下载体积、实际程序占盘、首次可操作时间、后续启动和更新下载量。Windows RC2 的 239.8 MiB 是这次完整功能文件集合的实测基线，不是未来版本的体积保证；增长时按分项审查，而不是随意放宽总预算。

官方 [Desktop README](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop/README.md)明确把 Electron、DSH 运行时和 pnpm 作为一套更新单元；[electron-builder 配置](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/desktop/scripts/electron-builder-config.mjs)也已限定打包文件并开启 Windows 差分包。`electron-builder` 的[官方配置说明](https://www.electron.build/docs/configuration/)指出 `maximum` 压缩通常增加构建时间而体积收益不明显，并提供 `electronLanguages` 选择；为了节省约 9 MB 而砍掉面向全球用户的 Electron 语言资源，不作为默认优化。

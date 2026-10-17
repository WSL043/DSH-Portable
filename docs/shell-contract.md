# 外壳与内核的接口版本（shell contract）

## 为什么

以前内核包只认「一个确切的 Portable 版本 + 一个确切的外壳指纹」。每发一次 Portable，launcher 文件就变，指纹就变，之前验证过的内核全部作废，旧版本用户也拿不到新内核——除非先更新 Portable。

现在内核包声明它**面向哪一版接口**（`requiredShellContract`，整数），外壳在自己的 `licenses/COMPONENTS.json` 里声明**自己说哪一版接口**（`shellContract`）。号码相同就接受，不再比较 Portable 版本和指纹。

## 接口指什么

外壳（`launcher/`）和内核运行时（装进 capsule 的 app 目录）互相点名的东西，共五类：

| 类别 | 内容 |
| --- | --- |
| `env` | 外壳传给内核的 `DSH_PORTABLE_*` 环境变量 |
| `bridge` | 页面与原生宿主之间的 `dsh-portable/*` 消息 |
| `cli` | 内核里的桥接服务调用的 `portable-cli` 命令 |
| `flag` | 这些命令用到的选项 |
| `file` | 内核按路径找的 `launcher/*.mjs` |

冻结记录在 [`config/shell-contract.json`](../config/shell-contract.json)，由 [`scripts/shell-contract.mjs`](../scripts/shell-contract.mjs) 扫描生成。`tests/shell-contract.test.mjs` 每次都拿当前代码和记录比对，对不上就失败。

## 改了接口怎么办

```bash
node scripts/shell-contract.mjs check    # 看差异
node scripts/shell-contract.mjs update   # 兼容变化（外壳多提供了东西）：刷新记录，号码不变
node scripts/shell-contract.mjs bump     # 破坏性变化：号码 +1 并刷新记录
```

判断标准：

- 新版内核开始依赖一个旧外壳从没提供过的名字 → **必须 bump**。
- 外壳删掉了内核也在用的名字 → **必须 bump**（旧内核装在新外壳上会坏）。
- 内核不再处理外壳仍会发的消息 → **必须 bump**。
- 外壳多提供、或只改外壳自己用的名字 → `update` 即可。

工具只看得见名字。名字没变但行为变了（例如同一条消息换了字段含义），要手动 bump。

bump 的代价：旧号码的外壳不再收到新内核，会提示「先更新 DSH-Portable」。所以只在确实无法兼容时才用。

## 安装内核时发生什么

内核更新包是在某个较新的 Portable 上验证的，它自带的 `COMPONENTS.json` 写着那个版本和指纹。安装时**不能**把这些写进用户的安装目录：外壳文件没有变，产品更新检查、关于页都读这个文件。所以安装前会把外壳身份（Portable 版本、指纹、契约号、WebView2 信息等）合并回已安装的值，运行时部分（内核版本、默认插件、pnpm 等）取自新包。`adoptInstalledShellIdentity` 实现这一步，失败回滚时一并还原。

## 仍然单独检查的条件

接口号相同不等于全部兼容。以下仍各自检查：随包 Node 版本、运行时布局（capsule/expanded）、更新机制自身的 `shellSchema`、更新器 schema。任何一项不满足会提示需要完整包更新。

## 没有接口号的旧版本

0.9.1 及更早的外壳不认识这个字段，仍按旧规则（确切版本 + 确切指纹）判断，所以这些用户需要先更新到带接口号的 Portable 一次，之后才能跟上新内核。这次更新后的提示也改成了「需要先更新 DSH-Portable」。

## 第三方插件

内核切换前，更新流程会用目标内核实际加载一遍现有 profile（`--dump-config`），加载不了就整个更新取消并回滚；能加载但插件声明的版本范围和新内核对不上，则更新完成后列出这些插件（`warnings`）。内置插件由 Updates 流水线在发布前核对，不会出现在这里。

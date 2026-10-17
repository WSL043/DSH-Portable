/**
 * pnpm compatibility layer — everything the market needs to know about how
 * different pnpm majors behave inside a dsh profile directory, kept pure and
 * separately testable (test/unit + test/integration exercise this module
 * against real pnpm 9/10/11).
 *
 * Verified behavior matrix (2026-08, pnpm 9.15.9 / 10.28.2 / 11.21.0):
 * - workspace root, `add` without -w:  pnpm 9 fails ERR_PNPM_ADDING_TO_ROOT;
 *   pnpm 10/11 succeed.
 * - `add -w` where NO pnpm-workspace.yaml exists: ALL majors fail with
 *   "--workspace-root may only be used inside a workspace".
 * - modules dir built by pnpm 9, then pnpm 10/11 mutate it:
 *   ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF (defaults drifted between majors).
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'


/**
 * Decide the argv for a `dsh plugin <add|remove> …` call in the given profile.
 *
 * pnpm 9 refuses to add at a workspace root without -w (#17, #20); every
 * pnpm major refuses -w when the directory is NOT a workspace. So the flag
 * is injected exactly when the profile has a pnpm-workspace.yaml.
 * @param profileDir - resolved profile directory (owns pnpm-workspace.yaml, or not).
 * @param pluginArgs - the raw args, e.g. ['add', 'dshmarket@latest'].
 * @returns args with -w injected when — and only when — the profile is a workspace root.
 */
export function pluginArgsFor(profileDir: string, pluginArgs: string[]): string[] {
  if (pluginArgs[0] !== 'add' && pluginArgs[0] !== 'remove') return pluginArgs
  if (!existsSync(join(profileDir, 'pnpm-workspace.yaml'))) return pluginArgs
  return [pluginArgs[0], '-w', ...pluginArgs.slice(1)]
}

/** One recognized pnpm failure, with a bilingual explanation for the UI. */
export const HOST_NAMESPACE_RE = /^@deepseek-ai\//

export interface PnpmFailure {
  code: 'adding-to-root' | 'not-a-workspace' | 'hoist-pattern-diff' | 'pnpm-missing' | 'release-age-violation'
    | 'ignored-builds' | 'git-prepare-not-allowed' | 'fetch-404' | 'transient-network' | 'fetch-timeout'
    | 'unexpected-store' | 'patch-failed' | 'missing-tarball-integrity' | 'windows-file-locked'
    | 'pnpm-unusable' | 'missing-local-dependency' | 'git-prepare-failed' | 'tarball-url-mismatch'
    | 'version-not-synced' | 'lockfile-broken' | 'lockfile-outdated'
  /** Bilingual, actionable message shown to the user instead of the raw wall of text. */
  message: string
  /** True when re-running `pnpm install` in the profile is the documented recovery. */
  recoverable: boolean
  /** Replace undecodable launcher output instead of appending this message to it. */
  replaceOutput?: boolean
  /** Package named by a registry 404, when pnpm supplied one. */
  pkg?: string
}

/**
 * Momentary network failures — worth exactly one automatic retry (#83).
 * pnpm 5xx fetch codes, its meta-fetch give-up, and the raw socket errors
 * that surface through dsh's wrapper. Permanent shapes (404, auth) are
 * deliberately absent: retrying those just doubles the wait for bad news.
 */
export function isTransientPnpmFailure(output: string): boolean {
  return /ERR_PNPM_FETCH_5\d\d|ERR_PNPM_META_FETCH_FAIL|FetchError|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|socket hang up|network timeout/i.test(output)
}

/**
 * pnpm's per-request fetch timeout: the abort surfaces as a DOMException
 * ("The operation was aborted due to timeout", code 23) through undici —
 * pnpm logs it as `GET … error (23)` before giving up. This is the failure
 * shape for large tarballs (github: sources download the WHOLE repo, even
 * for a `#path:` subdirectory plugin) on slow networks: pnpm's default
 * 60-second limit is simply not enough, so a plain retry fails again at the
 * same limit. The market's recovery re-runs once with a longer
 * fetchTimeout (see withHoistRecovery).
 */
export function isFetchTimeoutFailure(output: string): boolean {
  return /operation was aborted due to timeout|TimeoutError|error \(23\)/i.test(output)
}

/** Include messages nested in pnpm's ndjson reporter records. */
function withDecodedPnpmDiagnostics(output: string): string {
  const messages: string[] = [output]
  for (const line of output.split(/\r?\n/)) {
    try {
      const row = JSON.parse(line) as { message?: unknown; err?: { message?: unknown } }
      if (typeof row.message === 'string') messages.push(row.message)
      if (typeof row.err?.message === 'string') messages.push(row.err.message)
    } catch { /* human reporter or partial line */ }
  }
  return messages.join('\n').replaceAll('\\"', '"')
}

/**
 * Map a failed pnpm run's combined output to a known failure mode.
 *
 * dsh's own wrapper line ("dsh: pnpm failed in profile directory …") names no
 * cause, so the market must recognize pnpm's real diagnostics itself (#20).
 * @param output - stdout+stderr of the failed run.
 * @param exitCode - the run's exit status, when the caller has it. 9009 is
 *   cmd.exe's language-independent "command not found" status.
 * @returns the classified failure, or null when unrecognized (raw output is then shown as-is).
 */
export function classifyPnpmFailure(output: string, exitCode?: number | null): PnpmFailure | null {
  const decoded = withDecodedPnpmDiagnostics(output)
  if (output.includes('ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF')) {
    return {
      code: 'hoist-pattern-diff',
      recoverable: true,
      message: 'profile 的 node_modules 是旧版 pnpm 创建的，与当前 pnpm 的默认配置不兼容，需要重建后重试 / this profile\'s node_modules was created by a different pnpm major; it must be rebuilt (pnpm install) before changes can be applied',
    }
  }
  if (output.includes('ERR_PNPM_UNEXPECTED_STORE')) {
    const linked = /currently linked from the store at "([^"]+)"/.exec(output)?.[1]
    const wanted = /wants to use the store at "([^"]+)"/.exec(output)?.[1]
    const detail = linked !== undefined && wanted !== undefined
      ? `\n  node_modules → ${linked}\n  pnpm 现在想用 / pnpm now wants → ${wanted}`
      : ''
    return {
      code: 'unexpected-store',
      recoverable: false,
      message: `这个 profile 的 node_modules 连接到了另一个 pnpm store，安装和卸载会被拒绝。${detail}\n请先在 profile 目录使用上面原 store 路径重新执行 pnpm install；不要让市场猜测并自动改写整个依赖树 / this profile's node_modules is linked to a different pnpm store, so install and remove are refused.${detail}\nRelink it explicitly with pnpm install and the original store path; the market will not guess and rewrite the dependency tree automatically`,
    }
  }
  if (output.includes('ERR_PNPM_PATCH_FAILED')) {
    const patch = /Could not apply patch (\S+)/.exec(output)?.[1]
    const which = patch === undefined ? '' : `（${patch}）`
    const whichEn = patch === undefined ? '' : ` (${patch})`
    return {
      code: 'patch-failed',
      recoverable: false,
      message: `profile 里的 pnpm 补丁无法应用${which}。包可能已经以未打补丁的状态写入；请更新或删除补丁文件及 package.json 中 pnpm.patchedDependencies 的对应项 / a pnpm patch no longer applies${whichEn}. The package may already have been written unpatched; update or remove the patch and its pnpm.patchedDependencies entry`,
    }
  }
  if (output.includes('ERR_PNPM_ADDING_TO_ROOT')) {
    return {
      code: 'adding-to-root',
      recoverable: false,
      message: 'pnpm 拒绝在 workspace 根目录安装（缺少 -w）。请更新 DSH-Portable 后重试 / pnpm refused to add at a workspace root (missing -w); update DSH-Portable and try again',
    }
  }
  if (/--workspace-root may only be used inside a workspace/i.test(output)) {
    return {
      code: 'not-a-workspace',
      recoverable: false,
      message: 'profile 目录不是 pnpm workspace，却传入了 -w。请更新 DSH-Portable 后重试 / -w was passed but the profile is not a pnpm workspace; update DSH-Portable and try again',
    }
  }
  // #39: once a release younger than minimumReleaseAge is in the lockfile
  // (fresh install or a force-update), pnpm 11 verifies the WHOLE lockfile
  // before ANY later mutation — uninstalling even an unrelated plugin fails
  // (MINIMUM_RELEASE_AGE_VIOLATION), and a later add can fail re-resolving
  // the young dep (NO_MATURE_MATCHING_VERSION). Recovery is a one-shot
  // --config.minimumReleaseAge=0 retry, automated in withHoistRecovery.
  if (output.includes('ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION')
    || output.includes('ERR_PNPM_NO_MATURE_MATCHING_VERSION')) {
    return {
      code: 'release-age-violation',
      recoverable: false,
      message: '这个 profile 里有一个刚发布的插件版本，pnpm 的发布时间等待检查暂缓了本次改动。市场已用一次性确认重试；若仍看到本条，请导出日志反馈 / a newly published plugin version in this profile triggered pnpm\'s release-age wait; the market retried with a one-shot confirmation — if this remains, export the log and report it',
    }
  }
  // dsh-market #578: a version that exists on registry.npmjs.org but has not reached the user's mirror yet.
  // The market reads the registry directly while pnpm installs through the configured mirror, so a release
  // published minutes ago can be offered and then fail to resolve; the profile is untouched, retry later.
  if (output.includes('ERR_PNPM_NO_MATCHING_VERSION')) {
    return {
      code: 'version-not-synced',
      recoverable: false,
      message: '你的下载源还没有同步到这个新版本（刚发布的版本常有几分钟延迟），插件保持原样。请稍后重试 / your registry mirror has not synced this release yet (new releases can lag by minutes); the plugin is unchanged, retry later',
    }
  }
  // #69: pnpm >= 10 blocks dependency build scripts by default. The install
  // route has long surfaced this via the approve-builds banner (#6, #56),
  // but as a hard failure (pnpm 11 exits 1) the raw stack leaked through —
  // and the update route showed it verbatim.
  if (output.includes('ERR_PNPM_IGNORED_BUILDS')) {
    return {
      code: 'ignored-builds',
      recoverable: false,
      message: '有依赖需要执行构建脚本，被 pnpm 默认拦截。点击「允许构建脚本并重试」放行后重试即可 / a dependency needs to run build scripts, which pnpm blocks by default — click "Allow build scripts and retry" to approve and retry',
    }
  }
  // #68: git-hosted packages with a prepare/prepack script are rejected in
  // pnpm's FETCHER, before anything lands in node_modules — so the package
  // the user must approve is not installed yet, and pnpm's own hint names a
  // commit-pinned codeload URL that changes on every push.
  if (output.includes('ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED')) {
    return {
      code: 'git-prepare-not-allowed',
      recoverable: false,
      message: '这个 git 插件需要在安装时执行构建脚本，被 pnpm 默认拦截。点击「允许构建脚本并重试」放行后重试即可 / this git-hosted plugin needs to run its build script at install time, which pnpm blocks by default — click "Allow build scripts and retry" to approve and retry',
    }
  }
  const missingIntegrity = /Cannot (?:install|fetch) package "([^"@]+(?:@[^"@]+)?|@[^"/]+\/[^"@]+)@https?:\/\/[^"\s]+"[^\n]*no "integrity" field/i.exec(decoded)
  if (missingIntegrity !== null || /Cannot (?:install|fetch) package .*no "integrity" field/i.test(decoded)) {
    const pkg = missingIntegrity?.[1]
    return {
      code: 'missing-tarball-integrity',
      recoverable: false,
      ...(pkg === undefined ? {} : { pkg }),
      message: `这个 tarball 依赖没有声明完整性校验${pkg === undefined ? '' : `（${pkg}）`}，为避免下载内容被替换，市场不会猜测或自动补写校验值。请让插件作者发布带 integrity 的锁定来源 / this tarball dependency has no integrity metadata${pkg === undefined ? '' : ` (${pkg})`}; the market will not guess or write a checksum automatically — ask the plugin author to publish a source pinned with integrity`,
    }
  }
  // dsh-market #455: prefer an explicit inner failure over its prepare wrapper.
  if (output.includes('ERR_PNPM_TARBALL_URL_MISMATCH')) {
    const named = [...new Set([...decoded.matchAll(/(?<![\w./:@-])((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@[A-Za-z0-9._+-]+ has a tarball URL/gi)].map(match => match[1]))]
    const detail = named.length ? ` (${named.join(', ')})` : ''
    return {
      code: 'tarball-url-mismatch', recoverable: false,
      ...(named.length === 1 ? { pkg: named[0] } : {}),
      message: `锁定文件中的 tarball 地址与当前 registry 元数据不一致${detail}。请核对错误中列出的来源与 registry 配置；若错误来自 git 插件的构建，请让插件作者修正其锁定文件。完整错误保留在下方 / locked tarball URLs do not match the current registry metadata${detail}. Check the reported sources and registry configuration; if this occurred inside a git plugin build, ask its author to correct that lockfile. The full error is retained below`,
    }
  }
  if (output.includes('ERR_PNPM_PREPARE_PACKAGE')) {
    const pkg = /Failed to prepare git-hosted package fetched from "https:\/\/codeload\.github\.com\/[^\"]+":\s*((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@[A-Za-z0-9._+-]+/i.exec(decoded)?.[1]
    const detail = pkg ? ` (${pkg})` : ''
    return {
      code: 'git-prepare-failed', recoverable: false,
      ...(pkg ? { pkg } : {}),
      message: `git 插件的安装构建失败${detail}，此错误本身没有说明内部原因。请根据下方完整输出检查该插件的构建错误；内部日志缺失时，请向插件作者提供此错误，不要仅凭这一行改写 registry 或锁定文件 / a git plugin's install build failed${detail}; this wrapper error does not identify the inner cause. Check the full output below for its build error; if inner logs are absent, provide this error to the plugin author before changing registry settings or lockfiles`,
    }
  }
  // #65: a dependency that no longer resolves — an unpublished package left
  // in the manifest by an earlier failed operation (pnpm writes package.json
  // before it finishes), or a private-registry package without credentials.
  // pnpm re-resolves EVERY direct dependency on any add, so one ghost entry
  // blocks all later installs, of anything.
  if (output.includes('ERR_PNPM_FETCH_404')) {
    const pkg = /GET\s+\S*\/([^/\s]+):/.exec(output)?.[1].replace(/%2[Ff]/g, '/')
    const zh = pkg === undefined ? '' : `（${pkg}）`
    const en = pkg === undefined ? '' : ` (${pkg})`
    return {
      code: 'fetch-404',
      recoverable: false,
      pkg,
      message: `有一个依赖在 registry 上不存在${zh}，pnpm 因此拒绝任何安装操作。它可能是之前失败操作残留在 profile package.json 里的幽灵依赖（可手动删除该行），也可能是需要登录的私有包 / a dependency cannot be resolved from the registry${en}; pnpm refuses every install while it is present. It may be a ghost entry left in the profile's package.json by an earlier failed operation (remove that line by hand), or a private package needing registry credentials`,
    }
  }
  if (/ERR_PNPM_EPERM|EPERM:.*rename/i.test(decoded)) {
    const locked = /node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+?)(?:_tmp_\d+)?(?:[\\/'"]|$)/i.exec(decoded)?.[1]?.replaceAll('\\', '/')
    return {
      code: 'windows-file-locked',
      recoverable: false,
      ...(locked === undefined ? {} : { pkg: locked }),
      message: `Windows 正在占用插件文件${locked === undefined ? '' : `（${locked}）`}，pnpm 无法完成重命名；当前安装仍保持原状。请退出使用该插件的 DSH 窗口或重启后再试，并检查杀毒软件或索引器是否锁定目录 / Windows has a plugin file open${locked === undefined ? '' : ` (${locked})`}, so pnpm could not finish the rename; the current install remains intact. Quit DSH windows using it or restart before retrying, and check antivirus or indexing locks`,
    }
  }
  // #83: pnpm replays the WHOLE dependency tree on every add/remove, so a
  // moment of network flakiness against ANY already-installed dependency
  // (codeload tarball, registry meta) fails the run — and the market then
  // reported "install failed" for a plugin that was perfectly fine, only for
  // a plain retry to succeed seconds later. withHoistRecovery retries once;
  // this message covers the case where the retry lost too.
  if (isTransientPnpmFailure(output)) {
    return {
      code: 'transient-network',
      recoverable: false,
      message: '拉取依赖时网络临时失败（不一定是你正在装的插件——安装会重放整个依赖树，任何一个既有依赖抖动都会中断）。已自动重试一次仍失败，请稍后再试 / a transient network failure while fetching dependencies (not necessarily the plugin you are installing — installs replay the whole dependency tree, so any existing dependency can hiccup); one automatic retry failed too — please try again shortly',
    }
  }
  // pnpm's per-request fetch timeout (#…): large tarballs (github: sources
  // fetch the whole repo even for a `#path:` subdirectory) on slow networks
  // blow pnpm's default 60s limit. A plain retry fails again at the same
  // limit, so withHoistRecovery retries with a longer fetchTimeout.
  if (isFetchTimeoutFailure(output)) {
    return {
      code: 'fetch-timeout',
      recoverable: false,
      message: '下载超时：这个插件的安装包较大（github 源会下载整个仓库）或网络较慢，pnpm 默认的单次请求 60 秒限制不够用。市场已用更长的超时自动重试一次；若仍失败，请稍后再试或检查网络 / download timed out: this plugin ships a large tarball (github sources download the whole repository) or your network is slow, and pnpm\'s default 60-second per-request limit was not enough; the market retries once with a longer timeout — if it still fails, try again later or check the network',
    }
  }
  if (output.includes('pnpm not found on PATH')) {
    return {
      code: 'pnpm-missing',
      recoverable: false,
      message: '找不到 pnpm，请先在市场页顶部一键安装组件 / pnpm is not on PATH — use the one-click setup at the top of the market page',
    }
  }
  // A local `file:`/`.tgz` dependency can disappear after it was added. pnpm
  // re-resolves every direct dependency before any mutation, so that one
  // missing path blocks installs and uninstalls for the whole profile. Keep
  // the scope guard: an ENOENT from a build script is a different failure.
  const localMiss = /ENOENT: no such file or directory, open ['"]([^'"]+)['"]/i.exec(decoded)
  if (localMiss !== null && /while installing a direct dependency/i.test(decoded)) {
    const missingPath = localMiss[1]
    return {
      code: 'missing-local-dependency',
      recoverable: false,
      message: `profile 里有一个从本地文件安装的插件，但文件已经不在了（${missingPath}）。pnpm 在做任何改动前都会重新解析全部直接依赖，所以这一条会挡住这个 profile 里的所有安装和卸载——包括卸载别的插件。请先把这个文件恢复到原路径；如果无法恢复，请先备份 profile，再检查 package.json 里的对应本地来源和 dsh bundle 配置，修复后重试。 / a plugin in this profile was installed from a local file that no longer exists (${missingPath}). pnpm re-resolves every direct dependency before making any change, so this one entry blocks every install and uninstall in the profile — including uninstalling other plugins. First restore the file at its original path; if that is not possible, back up the profile, then inspect the matching local source in package.json and its dsh bundle configuration, repair them, and retry.`,
    }
  }
  // Portable's pnpm launcher can fail before pnpm runs. Windows cmd.exe
  // reports the missing launcher/environment case as 9009; a direct spawn
  // can report EACCES or ENOENT. These failures happen before pnpm can touch
  // the profile, so retrying or restoring a previous build is not useful.
  const spawnRefused = /(?:spawn(?:Sync)?\s+pnpm[^\r\n]*\b(EACCES|ENOENT)\b|\b(EACCES|ENOENT)\b[^\r\n]*spawn(?:Sync)?\s+pnpm)/i.exec(output)
  const spawnCause = spawnRefused === null ? null : (spawnRefused[1] ?? spawnRefused[2])
  const cmdNotFound = exitCode === 9009
    || /is not recognized as an internal or external command|不是内部或外部命令|不是內部或外部命令/i.test(output)
  if (cmdNotFound || spawnCause !== null) {
    const why = spawnCause === 'EACCES'
      ? {
          zh: '系统拒绝执行 Portable 私有 pnpm（EACCES，权限不足）。多半是私有文件没有执行权限，或者它所在的分区以 noexec 挂载；请打开 Portable 专用 DSH 终端检查私有 pnpm，并使用设置里的“检查并修复”，必要时重新解压完整安装包。',
          en: 'the system refused to execute Portable’s private pnpm (EACCES, permission denied). Usually the private file lacks execute permission, or it is on a noexec partition; open the Portable DSH terminal, check its private pnpm, use Settings > Check and repair, or re-extract the complete package.',
        }
      : spawnCause === 'ENOENT'
        ? {
            zh: 'Portable 私有 pnpm 的目标文件已经不在了（ENOENT），可能被删除或改名；请打开 Portable 专用 DSH 终端使用设置里的“检查并修复”，必要时重新解压完整安装包。',
            en: 'Portable’s private pnpm target is gone (ENOENT), possibly deleted or renamed; open the Portable DSH terminal, use Settings > Check and repair, or re-extract the complete package.',
          }
        : {
            zh: 'Portable 子进程没能启动 pnpm（退出码 9009）。可能是私有组件不完整，或市场启动环境没有带上 Portable 需要的变量；请打开 Portable 专用 DSH 终端运行检查，并使用设置里的“检查并修复”，必要时重新解压完整安装包。',
            en: "the Portable child process could not launch pnpm (exit code 9009). The private component may be incomplete, or the market was started without Portable's required environment; open the Portable DSH terminal, run the checks, use Settings > Check and repair, or re-extract the complete package.",
          }
    return {
      code: 'pnpm-unusable',
      recoverable: false,
      replaceOutput: true,
      message: `Portable 私有 pnpm 没能启动，插件没有任何改动。${why.zh}\n请只使用 Portable 专用 DSH 终端和设置里的检查/修复流程，不要绕过 Portable 的私有组件路径或环境。 / Portable's private pnpm could not be started, and nothing was changed. ${why.en}\nUse only the Portable DSH terminal and its Settings check/repair flow; do not bypass Portable's private component path or environment.`,
    }
  }
  // #808 by @Tofu707: the profile's own pnpm-lock.yaml is what is wrong, in
  // two shapes that pnpm reports with two codes and two different repairs, so
  // they are classified apart rather than merged into one answer.
  //
  // `lockfile-outdated` is tested first, because its anchor is a code and
  // nothing else. The sentence pnpm prints here also arrives WRAPPED across
  // lines in the human reporter ("… is not up" / "to date with
  // package.json."), so keying on that sentence instead of the code would miss
  // the form users actually see.
  //
  // The two failures do not happen in a fixed order, so nothing here — and
  // nothing in either message — claims which one a user meets first.
  //
  // `recoverable: false` on both: repeating the same command cannot help, the
  // lockfile has to change first.
  if (output.includes('ERR_PNPM_OUTDATED_LOCKFILE')) {
    return {
      code: 'lockfile-outdated',
      recoverable: false,
      message: 'profile 的 pnpm-lock.yaml 与 package.json 对不上：锁文件里记的 specifier 和 manifest 里声明的不是同一个，pnpm 因此在 frozen-lockfile 这一步直接拒绝，什么都没装。先备份一份 pnpm-lock.yaml，再在 profile 目录里重新生成锁文件（pnpm 最后一行会给出它自己那一版的命令；pnpm install --lockfile-only 也让锁文件与 package.json 对齐）后重试。这与「锁文件里缺条目」是两个不同的报错、对应两种不同的修法，两条命令不要互相套用（#808） / this profile\'s pnpm-lock.yaml does not match package.json: the specifier recorded in the lockfile is not the one the manifest declares, so pnpm refuses at the frozen-lockfile check and installs nothing. Back up pnpm-lock.yaml first, then regenerate the lockfile in the profile directory (pnpm\'s last line names the command for its own version; pnpm install --lockfile-only also realigns the lockfile with package.json) and retry. This is a different error with a different repair from a lockfile that is missing an entry — do not apply one repair to the other',
    }
  }
  // `lockfile-broken` is the lockfile contradicting ITSELF: an importer names
  // a dependency that has no entry under `packages:`. pnpm 11 and 12 word it
  // identically and both carry the code, so the rule keys on the code and on
  // pnpm's own phrase — and deliberately NOT on pnpm's closing `help:` line,
  // which drifts: 11.24.0 offers `pnpm install --no-frozen-lockfile` for this
  // failure while 12.8.1 offers `pnpm install --fix-lockfile` (and for the
  // outdated failure above it offers a third command again, `--lockfile-only`).
  // Measured 2026-10-08 against 11.24.0 and 12.8.1.
  //
  // Both shapes reach here whichever stream pnpm used. Market commands run with
  // `--reporter=ndjson`, and in that same measurement 11.24.0 wrote the error
  // record to stdout as one JSON line while 12.8.1 wrote nothing to stdout at
  // all (0 bytes) and put the error block on stderr as plain text.
  // withDecodedPnpmDiagnostics lifts the message out of the first form, and
  // both forms then carry these two strings verbatim.
  //
  // The missing entry is named in the message but deliberately NOT put in
  // `pkg`: callers read `pkg` as "the package this failure is about" and act on
  // it (the #289 peer retry, the #65 ghost-entry advice), and neither applies —
  // the repair is in the lockfile, not in the manifest entry.
  if (output.includes('ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY') || /Broken lockfile/.test(output)) {
    const broken = /no entry for '?([^'\s]+@[^'\s]+)'? in pnpm-lock\.yaml/i
      .exec(withDecodedPnpmDiagnostics(output))?.[1]
    const zh = broken === undefined ? '' : `（${broken}）`
    const en = broken === undefined ? '' : ` (${broken})`
    return {
      code: 'lockfile-broken',
      recoverable: false,
      message: `profile 的 pnpm-lock.yaml 自相矛盾：有个依赖在 importers 里记着，packages 里却没有它的条目${zh}，pnpm 因此在真正写 node_modules 的那一步拒绝整个命令。先备份一份 pnpm-lock.yaml；在 importers 下删掉这个依赖的那条记录（它的名字、specifier、version 三行），再在 profile 目录里执行 pnpm install --no-frozen-lockfile --lockfile-only，然后重试。不要用 pnpm 提示的 --fix-lockfile：在 12.x 上它修不好这种状态（11.x 上能修，所以那条提示只在 12.x 的 help 里出现，照它走会把 12.x 用户送到一条一定失败的命令上）。不要删掉整个 pnpm-lock.yaml，那会把其余插件的版本一起重新解析（#808） / this profile\'s pnpm-lock.yaml contradicts itself: a dependency is recorded in importers but has no entry under packages${en}, so pnpm refuses the whole command at the step that actually writes node_modules. Back up pnpm-lock.yaml first; remove that dependency\'s record from importers (its name, specifier and version lines); then run pnpm install --no-frozen-lockfile --lockfile-only in the profile directory and retry. Do not use the --fix-lockfile that pnpm itself suggests: on 12.x it does not repair this state (it does on 11.x, which is why that suggestion only appears in 12.x\'s help, and following it sends a 12.x user to a command that always fails). Do not delete the whole pnpm-lock.yaml either: that re-resolves every other plugin\'s version too (#808)`,
    }
  }
  return null
}

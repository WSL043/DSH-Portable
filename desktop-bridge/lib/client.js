window.__ModuleLoader__.load({
  id: '@wsl043/dsh-portable-desktop-bridge',
  factory: function (require) {
    const exports = {}
    const inject = ['slots', 'locale', 'theme', 'sessions', 'workspaces', 'uiWorkspace', 'sessionLogDownload', 'layout']
    const React = require('react')

    const copy = {
      "en": {
        "title": "Desktop & data",
        "invalidResult": "The operation returned an incomplete result. Retry or export a support report.",
        "dataExport": "Export data",
        "exportFormat": "Protection",
        "exportPlain": "Standard file",
        "exportEncrypted": "Password encrypted",
        "continue": "Continue",
        "updates": "Updates",
        "updateRecovery": "If a new version cannot start normally, the previous program is restored automatically while sessions, settings, plugins, and workspaces stay intact. Update checks are off by default and only run when you click them; you can turn on a startup check above.",
        "startupCheckProduct": "Check for Portable updates at startup",
        "startupCheckEngine": "Check for engine updates at startup",
        "installVersionNamed": "Install {0}",
        "productDowngradeHint": "The selected Portable is older than the current one. After downgrading, the engine you chose may not be restorable for now; nothing is deleted.",
        "coreRestoreWaiting": "Your chosen engine {0} is still being qualified for this Portable; later starts can try restoring it online after qualification. You are on {1} for now.",
        "coreRestoreRetry": "Your chosen engine {0} could not be restored yet (network or download problem); a later start can retry. You are on {1} for now.",
        "updateRolledBack": "The last update failed startup verification and automatically restored {0}.",
        "previousVersion": "the previous version",
        "product": "DSH-Portable",
        "productHint": "Desktop host, portable runtime, and integrations.",
        "engine": "DeepSeek Harness",
        "engineHint": "The official core updates independently. Choose a compatible, verified version.",
        "startupCheck": "Check at startup",
        "checkUpdate": "Check for updates",
        "installVersion": "Install selected version",
        "versionChoice": "Engine version",
        "engineDowngradeHint": "The selected engine is older than the current one. Sessions created with a newer engine may not open in an older one; nothing is deleted, and switching back restores access.",
        "productVersionChoice": "Portable version",
        "noProductVersions": "No other qualified versions are available.",
        "currentVersion": "Current {0}",
        "current": "No update available in this channel",
        "available": "{0} is available to install here.",
        "currentTag": "{0} (current)",
        "testCoreTag": "{0} (official test build)",
        "installUpdate": "Install update",
        "updateFromFile": "Update from file",
        "getUpdateFiles": "Get files",
        "getUpdateFilesHint": "Choose a folder to download and verify the JSON, signature and ZIP for a later update from file.",
        "desktopRequired": "Open the Portable desktop window to install updates.",
        "incompatible": "This core needs a matching Portable version first.",
        "awaitingQualification": "This core is still being tested. You do not need to do anything; it will appear in the list when it passes. Check for updates again later.",
        "engineFollowsProduct": "No matching core update is available yet. Please try again later.",
        "channelUnpublished": "No update package is available yet. Please try again later.",
        "updateUnavailable": "The update service is unavailable right now. Check your network or proxy and try again later.",
        "updateBusy": "Another update check is still running; try again in a moment.",
        "engineUnavailableSummary": "{0} newer core version(s) cannot be selected yet; open to see why.",
        "engineUnavailableCoreIncompatible": "Version {0}: Update Portable to {1} first to use this core version.",
        "engineUnavailableCoreAwaiting": "Version {0}: The new core must pass testing before it can be used with this Portable. You do not need to do anything; it will appear in the list above when it passes.",
        "engineUnavailableFullPackage": "Version {0}: A matching full Portable package is required.",
        "engineUnavailableWrongPlatform": "Version {0}: Not available for this system.",
        "engineUnavailableUnknown": "Version {0}: Compatibility with this version has not been verified.",
        "unknown": "Unknown",
        "engineCatalogInvalid": "The engine catalog response is invalid.",
        "notifications": "Task notifications",
        "notificationsHint": "Show a system notification when a background task finishes or needs an answer or approval.",
        "notificationsSystemDisabled": "Windows notifications are turned off. Enable them to receive background completion and attention alerts.",
        "updateReady": "Update available",
        "environmentActive": "Current isolated environment: {0}",
        "desktop": "Desktop behavior",
        "close": "When closing the window",
        "tray": "Minimize to tray",
        "exit": "Exit application",
        "environments": "Environments",
        "environmentTitle": "Isolated environments",
        "environmentHint": "Each environment keeps separate sessions, settings, credentials, plugins, and workspace. Opening another environment does not interrupt this one.",
        "defaultEnvironment": "Default environment",
        "newEnvironment": "New environment",
        "environmentName": "Environment name",
        "createEnvironment": "Create and open",
        "environmentOpened": "Opened {0}",
        "on": "On",
        "off": "Off",
        "care": "Maintenance",
        "maintenance": "Check and repair",
        "maintenanceHint": "Checks are read-only. Repair only rebuilds generated components and runs on the next start.",
        "community": "Help and feedback",
        "repository": "Project repository",
        "reportProblem": "Report a problem",
        "suggestIdea": "Suggest an idea",
        "starProject": "Leave a Star",
        "communityHint": "Opens GitHub for you to review and submit. Logs and sessions are not uploaded automatically.",
        "check": "Run check",
        "checking": "Checking…",
        "healthy": "No problems found",
        "issues": "{0} issue(s) found",
        "repair": "Repair safely on next start",
        "scheduled": "Scheduled for the next start",
        "repaired": "The last repair completed",
        "fullPackage": "Program files are incomplete. Keep this folder; extract a full package into a new folder, then migrate your data.",
        "clearWebCache": "Clear web cache",
        "webCacheCleared": "Web cache cleared. Sign-in state and local data were preserved.",
        "storageUsage": "View storage usage",
        "storagePartial": "Partial totals: scan limit or unreadable directories.",
        "storageClean": "Clean old runtimes and logs",
        "storageCleanResult": "Removed {0} old core runtimes, {2} old WebView runtimes and {1} expired logs.",
        "storageCleanPartial": "Some items are busy or could not be processed. Try again later.",
        "storageCleanProtected": "Plugin dependencies, sign-in data and recovery backups are retained.",
        "storageCleanFailed": "Some cleanup failed. Run a check or export a support report.",
        "storageCleanRuntime": "Core runtime",
        "storageCleanWebView": "WebView runtime",
        "storageCleanLogs": "Logs",
        "dependencyClean": "Clean plugin dependency cache",
        "dependencyCleaning": "Protecting installed and recovery versions, then cleaning dependencies…",
        "dependencyCleanResult": "Cleaned dependency caches in {0} environments; {1} retained references passed offline rebuild checks.",
        "dependencyCleanBlocked": "Cleanup did not complete. Installed plugins and recovery material were retained. Finish other installs or updates and retry; export a support report if it persists.",
        "dependencyCleanExternal": "A local plugin source could not be verified. Installed plugins and recovery material were retained.",
        "storageNames": "Plugin dependencies / Import backups / Recovery backups / Logs",
        "storageProtected": "File sizes may differ from disk space used. Dependencies support running plugins and offline recovery. Backups are not caches and are retained.",
        "report": "Export support report",
        "more": "More",
        "cancel": "Cancel",
        "exported": "Support report saved: {0}",
        "failed": "Operation failed: {0}",
        "data": "Data",
        "dataTitle": "Migration and backup",
        "dataHint": "Exports the selected contents; caches, runtimes, and workspace files stay out.",
        "dataScope": "Migration contents",
        "dataFull": "Full migration (including plugins and credentials)",
        "dataOnly": "Sessions and settings only (no plugins or credentials)",
        "dataStandard": "Export migration package",
        "dataStandardHint": "Not encrypted; use it only between devices you trust.",
        "dataPlainCredentialsWarning": "Note: this standard file contains your API credentials without encryption, so anyone who gets the file can use them. Prefer password encryption, or choose sessions and settings only.",
        "dataPrivate": "Export encrypted private package",
        "dataPrivateHint": "Contains the same data and requires its password to restore.",
        "dataPrivateDialogHint": "Set a recovery password for sessions, settings, plugins, and API credentials. DSH-Portable never stores it.",
        "dataPassword": "Password (8+ characters)",
        "dataPasswordConfirm": "Confirm password",
        "dataPasswordMismatch": "The passwords do not match.",
        "chooseSaveLocation": "Choose where to save the package before export starts.",
        "exportNow": "Choose location and export",
        "dataSaved": "Data package saved: {0}",
        "dataImport": "Import data package",
        "dataImportHint": "Choose a package exported by another DSH-Portable. Its contents are checked before import.",
        "dataImportPassword": "Enter package password",
        "dataImportPasswordHint": "This package is encrypted. The password is used for this import only and is never stored.",
        "dataImportReview": "Confirm import",
        "dataImportReviewHint": "Import {0} file(s). Package files replace conflicts and a rollback backup is created automatically.",
        "dataImportCategories": "Includes: {0}",
        "dataImportFiles": "Files",
        "dataImportMoreFiles": "{0} more file(s)",
        "dataImportRestart": "Restart and import",
        "dataImporting": "Restarting to import…"
      },
      "zh": {
        "title": "桌面与数据",
        "invalidResult": "未收到完整的操作结果，请重试或导出支持报告。",
        "dataExport": "导出数据",
        "exportFormat": "保护方式",
        "exportPlain": "普通文件",
        "exportEncrypted": "密码加密",
        "continue": "继续",
        "updates": "更新",
        "updateRecovery": "新版本无法正常启动时，会自动恢复更新前的程序；会话、设置、插件和工作区保持不变。更新检查默认关闭，只在你手动点击时进行；也可以在上面分别打开“启动时检查”。",
        "startupCheckProduct": "启动时检查 Portable 更新",
        "startupCheckEngine": "启动时检查内核更新",
        "installVersionNamed": "安装 {0}",
        "productDowngradeHint": "所选 Portable 比当前的旧。降级后，你选过的内核可能暂时无法恢复；数据不会被删除。",
        "coreRestoreWaiting": "你选择的内核 {0} 还在为这个 Portable 做验收，通过后会在后续启动时联网尝试恢复。现在使用的是 {1}。",
        "coreRestoreRetry": "暂时没能恢复你选择的内核 {0}（网络或下载失败），稍后启动时会尝试恢复。现在使用的是 {1}。",
        "updateRolledBack": "上次更新未通过启动验证，已自动恢复到 {0}。",
        "previousVersion": "上一版本",
        "product": "DSH-Portable",
        "productHint": "桌面窗口、便携运行环境与集成功能。",
        "engine": "DeepSeek Harness",
        "engineHint": "官方内核，独立于 Portable 更新。选择通过兼容验证的版本。",
        "startupCheck": "启动时检查",
        "checkUpdate": "检查更新",
        "installVersion": "安装所选版本",
        "versionChoice": "内核版本",
        "engineDowngradeHint": "所选内核比当前的旧。用较新内核创建的会话，在较旧内核里可能打不开；数据不会被删除，换回较新内核即可恢复。",
        "productVersionChoice": "Portable 版本",
        "noProductVersions": "暂无其他通过验收的版本。",
        "currentVersion": "当前 {0}",
        "current": "当前通道无可用更新",
        "available": "{0} 可用，可在此安装。",
        "currentTag": "{0}（当前）",
        "testCoreTag": "{0}（官方测试版）",
        "installUpdate": "安装更新",
        "updateFromFile": "从文件更新",
        "getUpdateFiles": "获取文件",
        "getUpdateFilesHint": "选择保存目录，自动下载并验证 JSON、签名和 ZIP；之后可从文件更新。",
        "desktopRequired": "请在 Portable 桌面窗口中安装更新。",
        "incompatible": "这个内核需要先把 Portable 升级到匹配的版本才能使用。",
        "awaitingQualification": "这个内核还在等待测试，不需要你做什么。通过后会自动出现在可选列表里，稍后再点“检查更新”即可。",
        "engineFollowsProduct": "暂时没有匹配的内核更新包，请稍后重试。",
        "channelUnpublished": "暂时没有可用更新包，请稍后重试。",
        "updateUnavailable": "暂时无法连接更新服务。请检查网络或代理，稍后再试。",
        "updateBusy": "另一个更新检查还在进行，请稍等片刻再试。",
        "engineUnavailableSummary": "另有 {0} 个更新的内核版本暂时不能选，点开看原因",
        "engineUnavailableCoreIncompatible": "版本 {0}：需要先把 Portable 升级到 {1}，才能使用这个内核版本。",
        "engineUnavailableCoreAwaiting": "版本 {0}：新内核需要先通过测试，才能和当前 Portable 一起使用。不需要你做什么，通过后会自动出现在上面的列表里。",
        "engineUnavailableFullPackage": "版本 {0}：需要匹配的完整 Portable 安装包。",
        "engineUnavailableWrongPlatform": "版本 {0}：不适用于此系统。",
        "engineUnavailableUnknown": "版本 {0}：尚未通过此版本兼容验证。",
        "unknown": "未知",
        "engineCatalogInvalid": "内核目录响应无效。",
        "notifications": "任务通知",
        "notificationsHint": "任务在后台完成，或等待回答和批准时显示系统通知。",
        "notificationsSystemDisabled": "Windows 通知已关闭；开启后，后台任务完成和待处理提醒才会显示。",
        "updateReady": "有可用更新",
        "environmentActive": "当前独立环境：{0}",
        "desktop": "桌面行为",
        "close": "关闭窗口时",
        "tray": "最小化到托盘",
        "exit": "退出程序",
        "environments": "环境",
        "environmentTitle": "独立环境",
        "environmentHint": "每个环境分别保存会话、设置、凭据、插件和工作区；打开另一个环境不会中断当前任务。",
        "defaultEnvironment": "默认环境",
        "newEnvironment": "新建环境",
        "environmentName": "环境名称",
        "createEnvironment": "创建并打开",
        "environmentOpened": "已打开 {0}",
        "on": "开启",
        "off": "关闭",
        "care": "维护",
        "maintenance": "检查与修复",
        "maintenanceHint": "检查不会修改文件；修复只重建可再生组件，并在下次启动时执行。",
        "community": "帮助与反馈",
        "repository": "项目仓库",
        "reportProblem": "反馈问题",
        "suggestIdea": "提出建议",
        "starProject": "喜欢的话，点个 Star",
        "communityHint": "在 GitHub 打开，由你确认提交；不会自动上传日志或会话。",
        "check": "运行检查",
        "checking": "正在检查…",
        "healthy": "未发现问题",
        "issues": "发现 {0} 项问题",
        "repair": "下次启动时安全修复",
        "scheduled": "已安排，下次启动时执行",
        "repaired": "上次修复已完成",
        "fullPackage": "程序文件不完整。请保留原目录，在新目录解压完整包后迁移数据。",
        "clearWebCache": "清理网页缓存",
        "webCacheCleared": "网页缓存已清理；登录状态和本地数据已保留。",
        "storageUsage": "查看存储占用",
        "storagePartial": "部分统计，未扫描完或有不可读目录。",
        "storageClean": "清理旧运行时和日志",
        "storageCleanResult": "已清理 {0} 个旧内核运行时、{2} 个旧 WebView 运行时、{1} 条过期日志。",
        "storageCleanPartial": "部分项目被占用或尚未处理完，可稍后再试。",
        "storageCleanProtected": "插件依赖、登录信息和恢复备份均保留。",
        "storageCleanFailed": "有项目清理失败，请运行检查或导出支持报告。",
        "storageCleanRuntime": "内核运行时",
        "storageCleanWebView": "WebView 运行时",
        "storageCleanLogs": "日志",
        "dependencyClean": "整理插件依赖缓存",
        "dependencyCleaning": "正在保护已安装插件和恢复版本，并整理依赖缓存…",
        "dependencyCleanResult": "已整理 {0} 个环境的依赖缓存，{1} 组插件引用通过离线重建检查。",
        "dependencyCleanBlocked": "依赖整理未完成，现用插件和恢复材料已保留。请结束其他安装或更新后重试；仍失败时导出支持报告。",
        "dependencyCleanExternal": "无法验证本地插件来源，已保留现用插件和恢复材料。",
        "storageNames": "插件依赖 / 导入备份 / 修复备份 / 日志",
        "storageProtected": "按文件大小统计，可能与实际磁盘占用不同。依赖供运行及离线恢复使用；备份不是缓存，不自动删除。",
        "report": "导出支持报告",
        "more": "更多",
        "cancel": "取消",
        "exported": "支持报告已保存：{0}",
        "failed": "操作失败：{0}",
        "data": "数据",
        "dataTitle": "迁移与备份",
        "dataHint": "按所选范围导出；不包含缓存、运行环境和工作区文件。",
        "dataScope": "迁移内容",
        "dataFull": "全部配置与会话（含插件和凭据）",
        "dataOnly": "仅会话与设置（不含插件和凭据）",
        "dataStandard": "导出迁移包",
        "dataStandardHint": "内容不加密，适合在你信任的设备之间迁移。",
        "dataPlainCredentialsWarning": "注意：这个普通文件包含你的 API 凭据且没有加密，拿到文件的人可以直接使用。建议选择“密码加密”，或改为“仅会话与设置”。",
        "dataPrivate": "导出加密私密包",
        "dataPrivateHint": "内容与迁移包相同，恢复时需要密码。",
        "dataPrivateDialogHint": "为会话、设置、插件和 API 凭据设置恢复密码。密码不会保存在 DSH-Portable 中。",
        "dataPassword": "密码（至少 8 位）",
        "dataPasswordConfirm": "确认密码",
        "dataPasswordMismatch": "两次输入的密码不一致。",
        "chooseSaveLocation": "选择保存位置后开始导出。",
        "exportNow": "选择位置并导出",
        "dataSaved": "数据包已保存：{0}",
        "dataImport": "导入数据包",
        "dataImportHint": "选择另一份 DSH-Portable 导出的数据包；导入前会先检查内容。",
        "dataImportPassword": "输入数据包密码",
        "dataImportPasswordHint": "这个数据包已加密。密码只用于本次导入，不会保存。",
        "dataImportReview": "确认导入",
        "dataImportReviewHint": "将导入 {0} 个文件。冲突项会由数据包替换，同时自动保留回滚备份。",
        "dataImportCategories": "包含：{0}",
        "dataImportFiles": "文件明细",
        "dataImportMoreFiles": "另有 {0} 个文件",
        "dataImportRestart": "重启并导入",
        "dataImporting": "正在重启并导入…"
      },
      "ja": {
        "title": "画面とデータ",
        "invalidResult": "操作結果が不完全です。再試行するか、サポートレポートを出力してください。",
        "dataExport": "データを出力",
        "exportFormat": "保護方式",
        "exportPlain": "通常ファイル",
        "exportEncrypted": "パスワードで暗号化",
        "continue": "続行",
        "updates": "更新",
        "updateRecovery": "起動確認に失敗した場合は更新前のプログラムへ自動で戻します。会話・設定・プラグイン・ワークスペースは保持します。更新確認は既定では手動です。起動時の確認は上で個別に有効にできます。",
        "startupCheckProduct": "起動時に Portable の更新を確認",
        "startupCheckEngine": "起動時にコアの更新を確認",
        "installVersionNamed": "{0} をインストール",
        "productDowngradeHint": "現在より古い Portable です。戻した後、選択済みのコアを一時的に復元できない場合があります。データは削除しません。",
        "coreRestoreWaiting": "選択済みのコア {0} は、この Portable での検証待ちです。検証後の起動時にオンラインで復元を試みます。現在は {1} を使用しています。",
        "coreRestoreRetry": "コア {0} の復元に失敗しました（通信またはダウンロードの問題）。次回以降の起動時に再試行します。現在は {1} を使用しています。",
        "updateRolledBack": "前回の更新は起動確認に失敗し、{0} に自動で戻しました。",
        "previousVersion": "以前のバージョン",
        "product": "DSH-Portable",
        "productHint": "デスクトップ画面、ポータブル実行環境、連携機能。",
        "engine": "DeepSeek Harness",
        "engineHint": "公式コアは個別に更新できます。互換性を検証済みのバージョンを選択してください。",
        "startupCheck": "起動時に確認",
        "checkUpdate": "更新を確認",
        "installVersion": "選択したバージョンをインストール",
        "versionChoice": "コアのバージョン",
        "engineDowngradeHint": "選択したエンジンは現在のエンジンよりも古いです。新しいエンジンで作成されたセッションは、古いエンジンでは開かない場合があります。何も削除されず、元に戻すとアクセスが復元されます。",
        "productVersionChoice": "Portable のバージョン",
        "noProductVersions": "ほかに検証済みのバージョンはありません。",
        "currentVersion": "現在 {0}",
        "current": "このチャンネルでは最新版です",
        "available": "{0} をインストールできます。",
        "currentTag": "{0}（現在）",
        "testCoreTag": "{0}（公式テスト版）",
        "installUpdate": "更新をインストール",
        "updateFromFile": "ファイルから更新",
        "getUpdateFiles": "更新ファイルを取得",
        "getUpdateFilesHint": "保存先を選ぶと、オフライン更新に必要な JSON・署名・ZIP をダウンロードして検証します。",
        "desktopRequired": "更新のインストールには Portable のデスクトップ画面を開いてください。",
        "incompatible": "先に対応する Portable への更新が必要です。",
        "awaitingQualification": "このコアは検証中です。合格すると一覧に表示されます。後ほど更新を再確認してください。",
        "engineFollowsProduct": "一致するコア アップデートはまだありません。後でもう一度試してください。",
        "channelUnpublished": "まだ利用可能な更新パッケージはありません。後でもう一度試してください。",
        "updateUnavailable": "現在、アップデートサービスはご利用いただけません。ネットワークまたはプロキシを確認し、後でもう一度試してください。",
        "updateBusy": "別の更新チェックがまだ実行中です。しばらくしてからもう一度試してください。",
        "engineUnavailableSummary": "まだ選択できない新しいコアが {0} 件あります。開くと理由を確認できます。",
        "engineUnavailableCoreIncompatible": "バージョン {0}: このコア バージョンを使用するには、最初にポータブルを {1} に更新します。",
        "engineUnavailableCoreAwaiting": "バージョン {0}: 新しいコアは、このポータブルで使用する前にテストに合格する必要があります。何もする必要はありません。合格すると上のリストに表示されます。",
        "engineUnavailableFullPackage": "バージョン {0}: 一致する完全なポータブル パッケージが必要です。",
        "engineUnavailableWrongPlatform": "バージョン {0}: このシステムでは使用できません。",
        "engineUnavailableUnknown": "バージョン {0}: このバージョンとの互換性は確認されていません。",
        "unknown": "不明",
        "engineCatalogInvalid": "エンジン カタログの応答が無効です。",
        "notifications": "タスク通知",
        "notificationsHint": "バックグラウンドのタスクが完了したときや、回答・承認が必要なときに通知します。",
        "notificationsSystemDisabled": "Windows の通知が無効です。タスクの完了や対応待ちの通知を受け取るには有効にしてください。",
        "updateReady": "更新があります",
        "environmentActive": "現在の独立環境：{0}",
        "desktop": "デスクトップの動作",
        "close": "ウィンドウを閉じるとき",
        "tray": "トレイに最小化",
        "exit": "アプリを終了",
        "environments": "環境",
        "environmentTitle": "独立環境",
        "environmentHint": "会話・設定・認証情報・プラグイン・ワークスペースを環境ごとに分けます。別の環境を開いても、現在のタスクは中断しません。",
        "defaultEnvironment": "既定の環境",
        "newEnvironment": "環境を作成",
        "environmentName": "環境名",
        "createEnvironment": "作成して開く",
        "environmentOpened": "{0} を開きました",
        "on": "オン",
        "off": "オフ",
        "care": "メンテナンス",
        "maintenance": "確認と修復",
        "maintenanceHint": "確認ではファイルを変更しません。修復は次回起動時に、再生成できる部品だけを再構築します。",
        "community": "ヘルプとフィードバック",
        "repository": "プロジェクトリポジトリ",
        "reportProblem": "問題を報告",
        "suggestIdea": "改善を提案",
        "starProject": "Star で応援",
        "communityHint": "GitHub を開きます。内容を確認してから送信してください。ログや会話を自動送信することはありません。",
        "check": "状態を確認",
        "checking": "確認中…",
        "healthy": "問題は見つかりませんでした",
        "issues": "{0} 件の問題が見つかりました",
        "repair": "次回起動時に修復",
        "scheduled": "次回起動時の修復を予約しました",
        "repaired": "前回の修復が完了しました",
        "fullPackage": "プログラムファイルが不足しています。元のフォルダーを残し、完全版を新しいフォルダーに展開してからデータを移行してください。",
        "clearWebCache": "Web キャッシュを消去",
        "webCacheCleared": "Web キャッシュを消去しました。ログイン状態とローカルデータは保持しています。",
        "storageUsage": "ストレージ使用量",
        "storagePartial": "走査が未完了、または読み取れないフォルダーがあるため、一部のみの集計です。",
        "storageClean": "旧ランタイムとログを整理",
        "storageCleanResult": "旧コア {0} 件、旧 WebView {2} 件、期限切れログ {1} 件を整理しました。",
        "storageCleanPartial": "使用中などの理由で処理できない項目があります。後ほど再試行してください。",
        "storageCleanProtected": "プラグイン依存関係・ログイン情報・復旧用バックアップは保持しています。",
        "storageCleanFailed": "一部の整理に失敗しました。状態を確認するか、サポートレポートを出力してください。",
        "storageCleanRuntime": "コアランタイム",
        "storageCleanWebView": "WebView ランタイム",
        "storageCleanLogs": "ログ",
        "dependencyClean": "プラグイン依存キャッシュを整理",
        "dependencyCleaning": "インストール済みプラグインと復旧用データを保護し、依存キャッシュを整理中…",
        "dependencyCleanResult": "{0} 環境の依存キャッシュを整理し、保持した {1} 組の参照からオフラインで再構築できることを確認しました。",
        "dependencyCleanBlocked": "整理が完了しませんでした。プラグインと復旧用データは保持しています。ほかのインストールや更新の完了後に再試行し、改善しなければサポートレポートを出力してください。",
        "dependencyCleanExternal": "ローカルプラグインの参照元を検証できませんでした。プラグインと復旧用データは保持しています。",
        "storageNames": "プラグイン依存関係 / インポート前のバックアップ / 復旧用バックアップ / ログ",
        "storageProtected": "ファイルサイズの集計であり、ディスク使用量とは異なる場合があります。依存関係は実行とオフライン復旧に使います。バックアップは自動削除しません。",
        "report": "サポートレポートを出力",
        "more": "その他",
        "cancel": "キャンセル",
        "exported": "サポートレポートを保存しました：{0}",
        "failed": "操作に失敗しました：{0}",
        "data": "データ",
        "dataTitle": "移行とバックアップ",
        "dataHint": "選択した内容を出力します。キャッシュ・実行環境・ワークスペース内のファイルは含みません。",
        "dataScope": "移行する内容",
        "dataFull": "すべて（プラグインと認証情報を含む）",
        "dataOnly": "会話と設定のみ（プラグイン・認証情報を除く）",
        "dataStandard": "移行パッケージを出力",
        "dataStandardHint": "暗号化しません。信頼できる端末間での移行に使用してください。",
        "dataPlainCredentialsWarning": "この通常ファイルには API 認証情報が暗号化されずに含まれます。入手した人が利用できるため、「パスワードで暗号化」または「会話と設定のみ」を推奨します。",
        "dataPrivate": "暗号化パッケージを出力",
        "dataPrivateHint": "同じ内容を暗号化します。復元にはパスワードが必要です。",
        "dataPrivateDialogHint": "会話・設定・プラグイン・API 認証情報を保護するパスワードを設定します。Portable にパスワードは保存しません。",
        "dataPassword": "パスワード（8文字以上）",
        "dataPasswordConfirm": "パスワードを再入力",
        "dataPasswordMismatch": "パスワードが一致しません。",
        "chooseSaveLocation": "保存先を選ぶと出力を開始します。",
        "exportNow": "保存先を選んで出力",
        "dataSaved": "データパッケージを保存しました：{0}",
        "dataImport": "データパッケージを読み込む",
        "dataImportHint": "別の Portable から出力したデータパッケージを選択してください。読み込み前に内容を確認します。",
        "dataImportPassword": "パッケージのパスワード",
        "dataImportPasswordHint": "暗号化されたパッケージです。パスワードは今回の読み込みだけに使用し、保存しません。",
        "dataImportReview": "読み込み内容の確認",
        "dataImportReviewHint": "{0} ファイルを読み込みます。競合する項目はパッケージの内容で置き換え、復旧用バックアップを自動で残します。",
        "dataImportCategories": "含む内容：{0}",
        "dataImportFiles": "ファイル一覧",
        "dataImportMoreFiles": "ほか {0} ファイル",
        "dataImportRestart": "再起動して読み込む",
        "dataImporting": "再起動して読み込み中…"
      },
      "es": {
        "title": "Escritorio y datos",
        "invalidResult": "La operación arrojó un resultado incompleto. Vuelva a intentar o exporte un informe de soporte.",
        "dataExport": "Exportar datos",
        "exportFormat": "Protección",
        "exportPlain": "Archivo estándar",
        "exportEncrypted": "Contraseña cifrada",
        "continue": "Continuar",
        "updates": "Actualizaciones",
        "updateRecovery": "Si una nueva versión no puede iniciarse normalmente, el programa anterior se restaura automáticamente mientras las sesiones, configuraciones, complementos y espacios de trabajo permanecen intactos. Las comprobaciones de actualización están desactivadas de forma predeterminada y solo se ejecutan cuando haces clic en ellas; Puedes activar una verificación de inicio arriba.",
        "startupCheckProduct": "Buscar actualizaciones de Portable al iniciar",
        "startupCheckEngine": "Buscar actualizaciones del núcleo al iniciar",
        "installVersionNamed": "Instalar {0}",
        "productDowngradeHint": "El portátil seleccionado es más antiguo que el actual. Después de degradar, es posible que el motor que eligió no se pueda restaurar por ahora; no se borra nada.",
        "coreRestoreWaiting": "La versión {0} del núcleo aún está pendiente de verificación para este Portable. Tras aprobarla, un inicio posterior podrá restaurarla en línea. Por ahora se usa {1}.",
        "coreRestoreRetry": "El motor elegido {0} aún no se ha podido restaurar (problema de red o de descarga); un inicio posterior puede volver a intentarlo. Estás en {1} por ahora.",
        "updateRolledBack": "La última actualización falló en la verificación de inicio y restauró automáticamente {0}.",
        "previousVersion": "la versión anterior",
        "product": "DSH-Portable",
        "productHint": "Host de escritorio, tiempo de ejecución portátil e integraciones.",
        "engine": "DeepSeek Harness",
        "engineHint": "El núcleo oficial se actualiza de forma independiente. Elija una versión compatible y verificada.",
        "startupCheck": "Comprobar al inicio",
        "checkUpdate": "Buscar actualizaciones",
        "installVersion": "Instalar la versión seleccionada",
        "versionChoice": "Versión del núcleo",
        "engineDowngradeHint": "El motor seleccionado es más antiguo que el actual. Es posible que las sesiones creadas con un motor más nuevo no se abran en uno más antiguo; no se elimina nada y volver a restaurar el acceso.",
        "productVersionChoice": "Versión de Portable",
        "noProductVersions": "No hay otras versiones calificadas disponibles.",
        "currentVersion": "Actual {0}",
        "current": "No hay actualizaciones disponibles en este canal.",
        "available": "{0} está disponible para instalar aquí.",
        "currentTag": "{0} (actual)",
        "testCoreTag": "{0} (compilación de prueba oficial)",
        "installUpdate": "Instalar actualización",
        "updateFromFile": "Actualizar desde archivo",
        "getUpdateFiles": "Obtener archivos",
        "getUpdateFilesHint": "Elija una carpeta para descargar y verificar el JSON, la firma y el ZIP para una actualización posterior del archivo.",
        "desktopRequired": "Abra la ventana del escritorio portátil para instalar actualizaciones.",
        "incompatible": "Este núcleo necesita primero una versión portátil correspondiente.",
        "awaitingQualification": "Este núcleo todavía se está probando. No necesitas hacer nada; aparecerá en la lista cuando pase. Busque actualizaciones nuevamente más tarde.",
        "engineFollowsProduct": "Aún no hay ninguna actualización principal disponible disponible. Inténtelo de nuevo más tarde.",
        "channelUnpublished": "Aún no hay ningún paquete de actualización disponible. Inténtelo de nuevo más tarde.",
        "updateUnavailable": "El servicio de actualización no está disponible en este momento. Verifique su red o proxy y vuelva a intentarlo más tarde.",
        "updateBusy": "Todavía se está ejecutando otra verificación de actualización; Inténtalo de nuevo en un momento.",
        "engineUnavailableSummary": "Todavía no se pueden seleccionar {0} versiones principales más recientes; ábrete para ver por qué.",
        "engineUnavailableCoreIncompatible": "Versión {0}: actualice Portable a {1} primero para usar esta versión principal.",
        "engineUnavailableCoreAwaiting": "Versión {0}: el nuevo núcleo debe pasar las pruebas antes de poder usarse con este portátil. No necesitas hacer nada; aparecerá en la lista de arriba cuando pase.",
        "engineUnavailableFullPackage": "Versión {0}: se requiere un paquete portátil completo que coincida.",
        "engineUnavailableWrongPlatform": "Versión {0}: No disponible para este sistema.",
        "engineUnavailableUnknown": "Versión {0}: no se ha verificado la compatibilidad con esta versión.",
        "unknown": "Desconocido",
        "engineCatalogInvalid": "La respuesta del catálogo de motores no es válida.",
        "notifications": "Notificaciones de tareas",
        "notificationsHint": "Muestre una notificación del sistema cuando finalice una tarea en segundo plano o necesite una respuesta o aprobación.",
        "notificationsSystemDisabled": "Las notificaciones de Windows están desactivadas. Permítales recibir alertas de atención y finalización en segundo plano.",
        "updateReady": "Actualización disponible",
        "environmentActive": "Entorno aislado actual: {0}",
        "desktop": "Comportamiento del escritorio",
        "close": "Al cerrar la ventana",
        "tray": "Minimizar a bandeja",
        "exit": "Salir de la aplicación",
        "environments": "Ambientes",
        "environmentTitle": "Ambientes aislados",
        "environmentHint": "Cada entorno mantiene sesiones, configuraciones, credenciales, complementos y espacio de trabajo separados. Abrir otro entorno no interrumpe este.",
        "defaultEnvironment": "Entorno predeterminado",
        "newEnvironment": "Nuevo entorno",
        "environmentName": "Nombre del entorno",
        "createEnvironment": "Crear y abrir",
        "environmentOpened": "Abierto {0}",
        "on": "Activado",
        "off": "Desactivado",
        "care": "Mantenimiento",
        "maintenance": "Comprobar y reparar",
        "maintenanceHint": "La comprobación no modifica archivos. La reparación solo reconstruye componentes regenerables y se ejecuta en el próximo inicio.",
        "community": "Ayuda y comentarios",
        "repository": "Repositorio de proyectos",
        "reportProblem": "Informar un problema",
        "suggestIdea": "Sugerir una idea",
        "starProject": "dejar una estrella",
        "communityHint": "Abre GitHub para que lo revise y envíe. Los registros y las sesiones no se cargan automáticamente.",
        "check": "Ejecutar verificación",
        "checking": "Comprobando…",
        "healthy": "No se encontraron problemas",
        "issues": "{0} problema(s) encontrado(s)",
        "repair": "Reparar al iniciar",
        "scheduled": "Programado para el próximo inicio",
        "repaired": "La última reparación completada.",
        "fullPackage": "Los archivos del programa están incompletos. Guarde esta carpeta; extraiga un paquete completo en una nueva carpeta y luego migre sus datos.",
        "clearWebCache": "Borrar caché web",
        "webCacheCleared": "Caché web borrado. Se conservaron los datos locales y estatales de inicio de sesión.",
        "storageUsage": "Ver uso de almacenamiento",
        "storagePartial": "Totales parciales: límite de escaneo o directorios ilegibles.",
        "storageClean": "Limpiar tiempos de ejecución y registros antiguos",
        "storageCleanResult": "Se eliminaron {0} tiempos de ejecución principales antiguos, {2} tiempos de ejecución de WebView antiguos y {1} registros caducados.",
        "storageCleanPartial": "Algunos elementos están ocupados o no se pudieron procesar. Vuelve a intentarlo más tarde.",
        "storageCleanProtected": "Se conservan las dependencias de complementos, los datos de inicio de sesión y las copias de seguridad de recuperación.",
        "storageCleanFailed": "Alguna limpieza falló. Ejecute una verificación o exporte un informe de soporte.",
        "storageCleanRuntime": "Tiempo de ejecución central",
        "storageCleanWebView": "Tiempo de ejecución de WebView",
        "storageCleanLogs": "Registros",
        "dependencyClean": "Limpiar caché de dependencia de complementos",
        "dependencyCleaning": "Proteger las versiones instaladas y de recuperación, luego limpiar las dependencias...",
        "dependencyCleanResult": "Se limpiaron las cachés de dependencia en {0} entornos; {1} referencias retenidas pasaron las comprobaciones de reconstrucción fuera de línea.",
        "dependencyCleanBlocked": "La limpieza no se completó. Se conservaron los complementos instalados y el material de recuperación. Finalice otras instalaciones o actualizaciones y vuelva a intentarlo; exporte un informe de soporte si persiste.",
        "dependencyCleanExternal": "No se pudo verificar una fuente de complemento local. Se conservaron los complementos instalados y el material de recuperación.",
        "storageNames": "Dependencias de complementos / Importar copias de seguridad / Recuperar copias de seguridad / Registros",
        "storageProtected": "Los tamaños de archivos pueden diferir del espacio en disco utilizado. Las dependencias admiten la ejecución de complementos y la recuperación sin conexión. Las copias de seguridad no son cachés y se conservan.",
        "report": "Informe de soporte de exportación",
        "more": "Más",
        "cancel": "Cancelar",
        "exported": "Informe de soporte guardado: {0}",
        "failed": "Operación fallida: {0}",
        "data": "Datos",
        "dataTitle": "Migración y copia de seguridad",
        "dataHint": "Exporta los contenidos seleccionados; los cachés, los tiempos de ejecución y los archivos del espacio de trabajo permanecen fuera.",
        "dataScope": "Contenidos de migración",
        "dataFull": "Migración completa (incluidos complementos y credenciales)",
        "dataOnly": "Solo sesiones y configuraciones (sin complementos ni credenciales)",
        "dataStandard": "Paquete de migración de exportación",
        "dataStandardHint": "No cifrado; Úselo solo entre dispositivos en los que confíe.",
        "dataPlainCredentialsWarning": "Nota: este archivo estándar contiene sus credenciales API sin cifrado, por lo que cualquiera que obtenga el archivo puede utilizarlas. Prefiere el cifrado de contraseña o elige sesiones y configuraciones únicamente.",
        "dataPrivate": "Exportar paquete privado cifrado",
        "dataPrivateHint": "Contiene los mismos datos y requiere su contraseña para restaurar.",
        "dataPrivateDialogHint": "Establezca una contraseña de recuperación para sesiones, configuraciones, complementos y credenciales de API. DSH-Portable nunca lo almacena.",
        "dataPassword": "Contraseña (8+ caracteres)",
        "dataPasswordConfirm": "Confirmar contraseña",
        "dataPasswordMismatch": "Las contraseñas no coinciden.",
        "chooseSaveLocation": "Elija dónde guardar el paquete antes de que comience la exportación.",
        "exportNow": "Elige ubicación y exporta",
        "dataSaved": "Paquete de datos guardado: {0}",
        "dataImport": "Importar paquete de datos",
        "dataImportHint": "Elija un paquete exportado por otro DSH-Portable. Su contenido se verifica antes de la importación.",
        "dataImportPassword": "Ingrese la contraseña del paquete",
        "dataImportPasswordHint": "Este paquete está cifrado. La contraseña se utiliza únicamente para esta importación y nunca se almacena.",
        "dataImportReview": "Confirmar importación",
        "dataImportReviewHint": "Importar {0} archivo(s). Los archivos de paquetes reemplazan los conflictos y se crea automáticamente una copia de seguridad de reversión.",
        "dataImportCategories": "Incluye: {0}",
        "dataImportFiles": "Archivos",
        "dataImportMoreFiles": "{0} archivo(s) más",
        "dataImportRestart": "Reiniciar e importar",
        "dataImporting": "Reiniciando para importar…"
      },
      "fr": {
        "title": "Bureau et données",
        "invalidResult": "L'opération a renvoyé un résultat incomplet. Réessayez ou exportez un rapport de support.",
        "dataExport": "Exporter des données",
        "exportFormat": "Protection",
        "exportPlain": "Fichier standard",
        "exportEncrypted": "Mot de passe crypté",
        "continue": "Continuer",
        "updates": "Mises à jour",
        "updateRecovery": "Si une nouvelle version ne peut pas démarrer normalement, le programme précédent est automatiquement restauré tandis que les sessions, les paramètres, les plugins et les espaces de travail restent intacts. Les vérifications de mise à jour sont désactivées par défaut et ne s'exécutent que lorsque vous cliquez dessus ; vous pouvez activer une vérification de démarrage ci-dessus.",
        "startupCheckProduct": "Vérifier les mises à jour de Portable au démarrage",
        "startupCheckEngine": "Vérifier les mises à jour du noyau au démarrage",
        "installVersionNamed": "Installer {0}",
        "productDowngradeHint": "Le portable sélectionné est plus ancien que l'actuel. Après le déclassement, le moteur que vous avez choisi ne pourra peut-être pas être restauré pour le moment ; rien n'est supprimé.",
        "coreRestoreWaiting": "Le noyau {0} attend encore sa validation pour ce Portable. Une fois validé, un prochain démarrage pourra le restaurer en ligne. La version actuelle est {1}.",
        "coreRestoreRetry": "Le moteur {0} que vous avez choisi n'a pas encore pu être restauré (problème de réseau ou de téléchargement) ; un démarrage ultérieur peut réessayer. Vous êtes sur {1} pour l'instant.",
        "updateRolledBack": "La dernière mise à jour a échoué à la vérification du démarrage et a restauré automatiquement {0}.",
        "previousVersion": "la version précédente",
        "product": "DSH-Portable",
        "productHint": "Hôte de bureau, runtime portable et intégrations.",
        "engine": "DeepSeek Harness",
        "engineHint": "Le noyau officiel est mis à jour indépendamment. Choisissez une version compatible et vérifiée.",
        "startupCheck": "Vérifier au démarrage",
        "checkUpdate": "Vérifier les mises à jour",
        "installVersion": "Installer la version sélectionnée",
        "versionChoice": "Version du noyau",
        "engineDowngradeHint": "Le moteur sélectionné est plus ancien que celui actuel. Les sessions créées avec un moteur plus récent peuvent ne pas s'ouvrir dans un moteur plus ancien ; rien n'est supprimé et le retour en arrière rétablit l'accès.",
        "productVersionChoice": "Version de Portable",
        "noProductVersions": "Aucune autre version qualifiée n'est disponible.",
        "currentVersion": "{0} actuel",
        "current": "Aucune mise à jour disponible sur cette chaîne",
        "available": "{0} peut être installé ici.",
        "currentTag": "{0} (actuel)",
        "testCoreTag": "{0} (version de test officielle)",
        "installUpdate": "Installer la mise à jour",
        "updateFromFile": "Mise à jour à partir du fichier",
        "getUpdateFiles": "Obtenir des fichiers",
        "getUpdateFilesHint": "Choisissez un dossier pour télécharger et vérifiez le JSON, la signature et le ZIP pour une mise à jour ultérieure à partir du fichier.",
        "desktopRequired": "Ouvrez la fenêtre du bureau portable pour installer les mises à jour.",
        "incompatible": "Ce noyau a d'abord besoin d'une version portable correspondante.",
        "awaitingQualification": "Ce noyau est encore en cours de test. Vous n’avez rien à faire ; il apparaîtra dans la liste une fois passé. Vérifiez à nouveau les mises à jour plus tard.",
        "engineFollowsProduct": "Aucune mise à jour principale correspondante n’est encore disponible. Veuillez réessayer plus tard.",
        "channelUnpublished": "Aucun package de mise à jour n'est encore disponible. Veuillez réessayer plus tard.",
        "updateUnavailable": "Le service de mise à jour n'est pas disponible pour le moment. Vérifiez votre réseau ou proxy et réessayez plus tard.",
        "updateBusy": "Une autre vérification de mise à jour est toujours en cours ; réessayez dans un instant.",
        "engineUnavailableSummary": "{0} version(s) principale(s) plus récente(s) ne peuvent pas encore être sélectionnées ; ouvert pour voir pourquoi.",
        "engineUnavailableCoreIncompatible": "Version {0} : mettez d'abord à jour Portable vers {1} pour utiliser cette version principale.",
        "engineUnavailableCoreAwaiting": "Version {0} : le nouveau noyau doit réussir les tests avant de pouvoir être utilisé avec ce portable. Vous n’avez rien à faire ; il apparaîtra dans la liste ci-dessus lors de son passage.",
        "engineUnavailableFullPackage": "Version {0} : un package portable complet correspondant est requis.",
        "engineUnavailableWrongPlatform": "Version {0} : non disponible pour ce système.",
        "engineUnavailableUnknown": "Version {0} : la compatibilité avec cette version n'a pas été vérifiée.",
        "unknown": "Inconnu",
        "engineCatalogInvalid": "La réponse du catalogue de moteurs n'est pas valide.",
        "notifications": "Notifications de tâches",
        "notificationsHint": "Afficher une notification système lorsqu'une tâche en arrière-plan se termine ou nécessite une réponse ou une approbation.",
        "notificationsSystemDisabled": "Les notifications Windows sont désactivées. Permettez-leur de recevoir des alertes d’achèvement et d’attention en arrière-plan.",
        "updateReady": "Mise à jour disponible",
        "environmentActive": "Environnement isolé actuel : {0}",
        "desktop": "Comportement du bureau",
        "close": "Lors de la fermeture de la fenêtre",
        "tray": "Réduire dans la zone de notification",
        "exit": "Quitter l'application",
        "environments": "Environnements",
        "environmentTitle": "Environnements isolés",
        "environmentHint": "Chaque environnement conserve des sessions, des paramètres, des informations d'identification, des plugins et un espace de travail distincts. L'ouverture d'un autre environnement n'interrompt pas celui-ci.",
        "defaultEnvironment": "Environnement par défaut",
        "newEnvironment": "Nouvel environnement",
        "environmentName": "Nom de l'environnement",
        "createEnvironment": "Créer et ouvrir",
        "environmentOpened": "Ouvert {0}",
        "on": "Activé",
        "off": "Désactivé",
        "care": "Entretien",
        "maintenance": "Vérifier et réparer",
        "maintenanceHint": "La vérification ne modifie aucun fichier. La réparation reconstruit uniquement les composants régénérables au prochain démarrage.",
        "community": "Aide et commentaires",
        "repository": "Dépôt de projet",
        "reportProblem": "Signaler un problème",
        "suggestIdea": "Proposer une idée",
        "starProject": "Laisser une étoile",
        "communityHint": "Ouvre GitHub pour que vous puissiez l'examiner et le soumettre. Les journaux et les sessions ne sont pas téléchargés automatiquement.",
        "check": "Exécuter une vérification",
        "checking": "Vérification…",
        "healthy": "Aucun problème trouvé",
        "issues": "{0} problème(s) trouvé(s)",
        "repair": "Réparer au prochain démarrage",
        "scheduled": "Prévu pour le prochain démarrage",
        "repaired": "La dernière réparation terminée",
        "fullPackage": "Les fichiers du programme sont incomplets. Conservez ce dossier ; extrayez un package complet dans un nouveau dossier, puis migrez vos données.",
        "clearWebCache": "Vider le cache Web",
        "webCacheCleared": "Cache Web vidé. L’état de connexion et les données locales ont été préservés.",
        "storageUsage": "Afficher l'utilisation du stockage",
        "storagePartial": "Totaux partiels : limite d'analyse ou répertoires illisibles.",
        "storageClean": "Nettoyer les anciens environnements d'exécution et les journaux",
        "storageCleanResult": "Suppression de {0} anciens environnements d'exécution principaux, {2} anciens environnements d'exécution WebView et {1} journaux expirés.",
        "storageCleanPartial": "Certains éléments sont occupés ou n'ont pas pu être traités. Réessayez plus tard.",
        "storageCleanProtected": "Les dépendances du plugin, les données de connexion et les sauvegardes de récupération sont conservées.",
        "storageCleanFailed": "Un nettoyage a échoué. Exécutez une vérification ou exportez un rapport de support.",
        "storageCleanRuntime": "Runtime de base",
        "storageCleanWebView": "Exécution WebView",
        "storageCleanLogs": "Journaux",
        "dependencyClean": "Nettoyer le cache des dépendances du plugin",
        "dependencyCleaning": "Protéger les versions installées et de récupération, puis nettoyer les dépendances…",
        "dependencyCleanResult": "Caches de dépendances nettoyés dans les environnements {0} ; {1} références conservées ont réussi les contrôles de reconstruction hors ligne.",
        "dependencyCleanBlocked": "Le nettoyage n'est pas terminé. Les plugins installés et le matériel de récupération ont été conservés. Terminez les autres installations ou mises à jour et réessayez ; exporter un rapport de support s’il persiste.",
        "dependencyCleanExternal": "Une source de plugin locale n'a pas pu être vérifiée. Les plugins installés et le matériel de récupération ont été conservés.",
        "storageNames": "Dépendances du plugin / Sauvegardes d'importation / Sauvegardes de récupération / Journaux",
        "storageProtected": "La taille des fichiers peut différer de l'espace disque utilisé. Les dépendances prennent en charge l'exécution de plugins et la récupération hors ligne. Les sauvegardes ne sont pas des caches et sont conservées.",
        "report": "Rapport de support à l'exportation",
        "more": "Plus",
        "cancel": "Annuler",
        "exported": "Rapport d'assistance enregistré : {0}",
        "failed": "Échec de l'opération : {0}",
        "data": "Données",
        "dataTitle": "Migration et sauvegarde",
        "dataHint": "Exporte le contenu sélectionné ; les caches, les environnements d'exécution et les fichiers d'espace de travail restent à l'écart.",
        "dataScope": "Contenu de la migration",
        "dataFull": "Migration complète (y compris les plugins et les informations d'identification)",
        "dataOnly": "Sessions et paramètres uniquement (pas de plugins ni d'informations d'identification)",
        "dataStandard": "Forfait de migration à l'exportation",
        "dataStandardHint": "Non crypté ; utilisez-le uniquement entre des appareils en qui vous avez confiance.",
        "dataPlainCredentialsWarning": "Remarque : ce fichier standard contient vos informations d'identification API sans cryptage, afin que toute personne recevant le fichier puisse les utiliser. Préférez le cryptage par mot de passe ou choisissez uniquement les sessions et les paramètres.",
        "dataPrivate": "Exporter un package privé chiffré",
        "dataPrivateHint": "Contient les mêmes données et nécessite son mot de passe pour être restauré.",
        "dataPrivateDialogHint": "Définissez un mot de passe de récupération pour les sessions, les paramètres, les plugins et les informations d'identification API. DSH-Portable ne le stocke jamais.",
        "dataPassword": "Mot de passe (8+ caractères)",
        "dataPasswordConfirm": "Confirmer le mot de passe",
        "dataPasswordMismatch": "Les mots de passe ne correspondent pas.",
        "chooseSaveLocation": "Choisissez où enregistrer le package avant le début de l’exportation.",
        "exportNow": "Choisissez l'emplacement et exportez",
        "dataSaved": "Paquet de données enregistré : {0}",
        "dataImport": "Importer un paquet de données",
        "dataImportHint": "Choisissez un package exporté par un autre DSH-Portable. Son contenu est vérifié avant l'importation.",
        "dataImportPassword": "Entrez le mot de passe du package",
        "dataImportPasswordHint": "Ce paquet est crypté. Le mot de passe est utilisé uniquement pour cette importation et n'est jamais stocké.",
        "dataImportReview": "Confirmer l'importation",
        "dataImportReviewHint": "Importez {0} fichier(s). Les fichiers de package remplacent les conflits et une sauvegarde de restauration est créée automatiquement.",
        "dataImportCategories": "Comprend : {0}",
        "dataImportFiles": "Fichiers",
        "dataImportMoreFiles": "{0} fichier(s) supplémentaire(s)",
        "dataImportRestart": "Redémarrer et importer",
        "dataImporting": "Redémarrage de l'importation…"
      },
      "de": {
        "title": "Desktop und Daten",
        "invalidResult": "Der Vorgang hat ein unvollständiges Ergebnis zurückgegeben. Versuchen Sie es erneut oder exportieren Sie einen Supportbericht.",
        "dataExport": "Daten exportieren",
        "exportFormat": "Schutz",
        "exportPlain": "Standarddatei",
        "exportEncrypted": "Passwort verschlüsselt",
        "continue": "Weiter",
        "updates": "Aktualisierungen",
        "updateRecovery": "Wenn eine neue Version nicht normal starten kann, wird das vorherige Programm automatisch wiederhergestellt, während Sitzungen, Einstellungen, Plugins und Arbeitsbereiche intakt bleiben. Update-Prüfungen sind standardmäßig deaktiviert und werden nur ausgeführt, wenn Sie darauf klicken. Sie können oben eine Startprüfung aktivieren.",
        "startupCheckProduct": "Beim Start nach Portable-Updates suchen",
        "startupCheckEngine": "Beim Start nach Kern-Updates suchen",
        "installVersionNamed": "Installieren Sie {0}",
        "productDowngradeHint": "Das ausgewählte tragbare Gerät ist älter als das aktuelle. Nach dem Downgrade kann es sein, dass die von Ihnen gewählte Engine vorerst nicht wiederhergestellt werden kann. nichts wird gelöscht.",
        "coreRestoreWaiting": "Der gewählte Kern {0} wartet noch auf die Prüfung für dieses Portable. Nach erfolgreicher Prüfung kann ein späterer Start ihn online wiederherstellen. Derzeit wird {1} verwendet.",
        "coreRestoreRetry": "Die von Ihnen gewählte Engine {0} konnte noch nicht wiederhergestellt werden (Netzwerk- oder Downloadproblem); Bei einem späteren Start kann es erneut versucht werden. Sie befinden sich derzeit auf {1}.",
        "updateRolledBack": "Beim letzten Update ist die Startüberprüfung fehlgeschlagen und {0} wurde automatisch wiederhergestellt.",
        "previousVersion": "die vorherige Version",
        "product": "DSH-Portable",
        "productHint": "Desktop-Host, tragbare Laufzeit und Integrationen.",
        "engine": "DeepSeek Harness",
        "engineHint": "Der offizielle Kern wird unabhängig aktualisiert. Wählen Sie eine kompatible, verifizierte Version.",
        "startupCheck": "Beim Start überprüfen",
        "checkUpdate": "Suchen Sie nach Updates",
        "installVersion": "Ausgewählte Version installieren",
        "versionChoice": "Kernversion",
        "engineDowngradeHint": "Die ausgewählte Engine ist älter als die aktuelle. Mit einer neueren Engine erstellte Sitzungen werden möglicherweise nicht in einer älteren Engine geöffnet. Es wird nichts gelöscht und durch Zurückschalten wird der Zugriff wiederhergestellt.",
        "productVersionChoice": "Portable-Version",
        "noProductVersions": "Es sind keine anderen qualifizierten Versionen verfügbar.",
        "currentVersion": "Aktuell {0}",
        "current": "In diesem Kanal ist kein Update verfügbar",
        "available": "{0} kann hier installiert werden.",
        "currentTag": "{0} (aktuell)",
        "testCoreTag": "{0} (offizieller Testbuild)",
        "installUpdate": "Update installieren",
        "updateFromFile": "Update aus Datei",
        "getUpdateFiles": "Holen Sie sich Dateien",
        "getUpdateFilesHint": "Wählen Sie einen Ordner zum Herunterladen und überprüfen Sie JSON, Signatur und ZIP für eine spätere Aktualisierung aus der Datei.",
        "desktopRequired": "Öffnen Sie das Fenster „Portable Desktop“, um Updates zu installieren.",
        "incompatible": "Dieser Kern benötigt zunächst eine passende Portable-Version.",
        "awaitingQualification": "Dieser Kern wird noch getestet. Sie müssen nichts tun; Es wird in der Liste angezeigt, wenn es erfolgreich ist. Suchen Sie später erneut nach Updates.",
        "engineFollowsProduct": "Es ist noch kein passendes Core-Update verfügbar. Bitte versuchen Sie es später noch einmal.",
        "channelUnpublished": "Es ist noch kein Update-Paket verfügbar. Bitte versuchen Sie es später noch einmal.",
        "updateUnavailable": "Der Update-Dienst ist derzeit nicht verfügbar. Überprüfen Sie Ihr Netzwerk oder Ihren Proxy und versuchen Sie es später erneut.",
        "updateBusy": "Es läuft noch eine weitere Update-Prüfung; Versuchen Sie es gleich noch einmal.",
        "engineUnavailableSummary": "{0} neuere Kernversion(en) können noch nicht ausgewählt werden; offen, um zu sehen, warum.",
        "engineUnavailableCoreIncompatible": "Version {0}: Aktualisieren Sie zuerst Portable auf {1}, um diese Kernversion zu verwenden.",
        "engineUnavailableCoreAwaiting": "Version {0}: Der neue Kern muss die Tests bestehen, bevor er mit diesem tragbaren Gerät verwendet werden kann. Sie müssen nichts tun; Es wird in der Liste oben angezeigt, wenn es erfolgreich ist.",
        "engineUnavailableFullPackage": "Version {0}: Ein passendes vollständiges Portable-Paket ist erforderlich.",
        "engineUnavailableWrongPlatform": "Version {0}: Für dieses System nicht verfügbar.",
        "engineUnavailableUnknown": "Version {0}: Die Kompatibilität mit dieser Version wurde nicht überprüft.",
        "unknown": "Unbekannt",
        "engineCatalogInvalid": "Die Antwort des Engine-Katalogs ist ungültig.",
        "notifications": "Aufgabenbenachrichtigungen",
        "notificationsHint": "Zeigen Sie eine Systembenachrichtigung an, wenn eine Hintergrundaufgabe abgeschlossen ist oder eine Antwort oder Genehmigung benötigt.",
        "notificationsSystemDisabled": "Windows-Benachrichtigungen sind deaktiviert. Ermöglichen Sie ihnen, Abschluss- und Aufmerksamkeitsbenachrichtigungen im Hintergrund zu erhalten.",
        "updateReady": "Update verfügbar",
        "environmentActive": "Aktuelle isolierte Umgebung: {0}",
        "desktop": "Desktop-Verhalten",
        "close": "Beim Schließen des Fensters",
        "tray": "In den Infobereich minimieren",
        "exit": "Anwendung beenden",
        "environments": "Umgebungen",
        "environmentTitle": "Isolierte Umgebungen",
        "environmentHint": "Jede Umgebung verfügt über separate Sitzungen, Einstellungen, Anmeldeinformationen, Plugins und Arbeitsbereiche. Durch das Öffnen einer anderen Umgebung wird diese nicht unterbrochen.",
        "defaultEnvironment": "Standardumgebung",
        "newEnvironment": "Neue Umgebung",
        "environmentName": "Umgebungsname",
        "createEnvironment": "Erstellen und öffnen",
        "environmentOpened": "Geöffnet {0}",
        "on": "Ein",
        "off": "Aus",
        "care": "Wartung",
        "maintenance": "Überprüfen und reparieren",
        "maintenanceHint": "Die Prüfung ändert keine Dateien. Die Reparatur erstellt beim nächsten Start nur regenerierbare Komponenten neu.",
        "community": "Hilfe und Feedback",
        "repository": "Projekt-Repository",
        "reportProblem": "Melden Sie ein Problem",
        "suggestIdea": "Schlagen Sie eine Idee vor",
        "starProject": "Hinterlasse einen Stern",
        "communityHint": "Öffnet GitHub, damit Sie es überprüfen und einreichen können. Protokolle und Sitzungen werden nicht automatisch hochgeladen.",
        "check": "Führen Sie die Prüfung durch",
        "checking": "Überprüfen…",
        "healthy": "Keine Probleme gefunden",
        "issues": "{0} Problem(e) gefunden",
        "repair": "Beim nächsten Start reparieren",
        "scheduled": "Geplant für den nächsten Start",
        "repaired": "Die letzte Reparatur abgeschlossen",
        "fullPackage": "Programmdateien sind unvollständig. Behalten Sie diesen Ordner; Extrahieren Sie ein vollständiges Paket in einen neuen Ordner und migrieren Sie dann Ihre Daten.",
        "clearWebCache": "Web-Cache leeren",
        "webCacheCleared": "Web-Cache geleert. Anmeldestatus und lokale Daten wurden beibehalten.",
        "storageUsage": "Speichernutzung anzeigen",
        "storagePartial": "Teilsummen: Scan-Limit oder nicht lesbare Verzeichnisse.",
        "storageClean": "Bereinigen Sie alte Laufzeiten und Protokolle",
        "storageCleanResult": "{0} alte Kernlaufzeiten, {2} alte WebView-Laufzeiten und {1} abgelaufene Protokolle wurden entfernt.",
        "storageCleanPartial": "Einige Elemente sind beschäftigt oder konnten nicht verarbeitet werden. Versuchen Sie es später noch einmal.",
        "storageCleanProtected": "Plugin-Abhängigkeiten, Anmeldedaten und Wiederherstellungs-Backups bleiben erhalten.",
        "storageCleanFailed": "Einige Aufräumarbeiten sind fehlgeschlagen. Führen Sie eine Prüfung durch oder exportieren Sie einen Supportbericht.",
        "storageCleanRuntime": "Kernlaufzeit",
        "storageCleanWebView": "WebView-Laufzeit",
        "storageCleanLogs": "Protokolle",
        "dependencyClean": "Bereinigen Sie den Plugin-Abhängigkeits-Cache",
        "dependencyCleaning": "Installierte Versionen und Wiederherstellungsversionen schützen und anschließend Abhängigkeiten bereinigen …",
        "dependencyCleanResult": "Abhängigkeitscaches in {0}-Umgebungen bereinigt; {1} beibehaltene Referenzen haben die Offline-Neuerstellungsprüfungen bestanden.",
        "dependencyCleanBlocked": "Die Bereinigung wurde nicht abgeschlossen. Installierte Plugins und Wiederherstellungsmaterial wurden beibehalten. Schließen Sie andere Installationen oder Updates ab und versuchen Sie es erneut. Exportieren Sie einen Supportbericht, wenn das Problem weiterhin besteht.",
        "dependencyCleanExternal": "Eine lokale Plugin-Quelle konnte nicht überprüft werden. Installierte Plugins und Wiederherstellungsmaterial wurden beibehalten.",
        "storageNames": "Plugin-Abhängigkeiten / Backups importieren / Wiederherstellungs-Backups / Protokolle",
        "storageProtected": "Die Dateigrößen können vom verwendeten Speicherplatz abweichen. Abhängigkeiten unterstützen die Ausführung von Plugins und die Offline-Wiederherstellung. Backups sind keine Caches und werden aufbewahrt.",
        "report": "Supportbericht exportieren",
        "more": "Mehr",
        "cancel": "Abbrechen",
        "exported": "Supportbericht gespeichert: {0}",
        "failed": "Vorgang fehlgeschlagen: {0}",
        "data": "Daten",
        "dataTitle": "Migration und Backup",
        "dataHint": "Exportiert die ausgewählten Inhalte; Caches, Laufzeiten und Arbeitsbereichsdateien bleiben draußen.",
        "dataScope": "Migrationsinhalte",
        "dataFull": "Vollständige Migration (einschließlich Plugins und Anmeldeinformationen)",
        "dataOnly": "Nur Sitzungen und Einstellungen (keine Plugins oder Anmeldeinformationen)",
        "dataStandard": "Migrationspaket exportieren",
        "dataStandardHint": "Nicht verschlüsselt; Verwenden Sie es nur zwischen Geräten, denen Sie vertrauen.",
        "dataPlainCredentialsWarning": "Hinweis: Diese Standarddatei enthält Ihre API-Anmeldeinformationen ohne Verschlüsselung, sodass jeder, der die Datei erhält, sie verwenden kann. Bevorzugen Sie die Passwortverschlüsselung oder wählen Sie nur Sitzungen und Einstellungen.",
        "dataPrivate": "Verschlüsseltes privates Paket exportieren",
        "dataPrivateHint": "Enthält dieselben Daten und erfordert zum Wiederherstellen sein Passwort.",
        "dataPrivateDialogHint": "Legen Sie ein Wiederherstellungskennwort für Sitzungen, Einstellungen, Plugins und API-Anmeldeinformationen fest. DSH-Portable speichert es niemals.",
        "dataPassword": "Passwort (8+ Zeichen)",
        "dataPasswordConfirm": "Passwort bestätigen",
        "dataPasswordMismatch": "Die Passwörter stimmen nicht überein.",
        "chooseSaveLocation": "Wählen Sie aus, wo das Paket gespeichert werden soll, bevor der Export beginnt.",
        "exportNow": "Wählen Sie einen Speicherort und exportieren Sie ihn",
        "dataSaved": "Datenpaket gespeichert: {0}",
        "dataImport": "Datenpaket importieren",
        "dataImportHint": "Wählen Sie ein Paket, das von einem anderen DSH-Portable exportiert wurde. Der Inhalt wird vor dem Import überprüft.",
        "dataImportPassword": "Geben Sie das Paketpasswort ein",
        "dataImportPasswordHint": "Dieses Paket ist verschlüsselt. Das Passwort wird nur für diesen Import verwendet und niemals gespeichert.",
        "dataImportReview": "Bestätigen Sie den Import",
        "dataImportReviewHint": "Importieren Sie {0} Datei(en). Paketdateien ersetzen Konflikte und es wird automatisch ein Rollback-Backup erstellt.",
        "dataImportCategories": "Beinhaltet: {0}",
        "dataImportFiles": "Dateien",
        "dataImportMoreFiles": "{0} weitere Datei(en)",
        "dataImportRestart": "Neu starten und importieren",
        "dataImporting": "Import wird neu gestartet..."
      },
      "ru": {
        "title": "Рабочий стол и данные",
        "invalidResult": "Операция вернула неполный результат. Повторите попытку или экспортируйте отчет поддержки.",
        "dataExport": "Экспорт данных",
        "exportFormat": "Защита",
        "exportPlain": "Стандартный файл",
        "exportEncrypted": "Пароль зашифрован",
        "continue": "Продолжить",
        "updates": "Обновления",
        "updateRecovery": "Если новая версия не может запуститься нормально, предыдущая программа восстанавливается автоматически, при этом сеансы, настройки, плагины и рабочие области остаются нетронутыми. Проверки обновлений по умолчанию отключены и запускаются только при нажатии на них; вы можете включить проверку запуска выше.",
        "startupCheckProduct": "Проверять обновления Portable при запуске",
        "startupCheckEngine": "Проверять обновления ядра при запуске",
        "installVersionNamed": "Установить {0}",
        "productDowngradeHint": "Выбранный портативный компьютер старше текущего. После перехода на более раннюю версию выбранный вами двигатель может оказаться не подлежащим восстановлению; ничего не удаляется.",
        "coreRestoreWaiting": "Выбранное ядро {0} ещё ожидает проверки для этой версии Portable. После успешной проверки его можно будет восстановить по сети при следующем запуске. Сейчас используется {1}.",
        "coreRestoreRetry": "Выбранный вами движок {0} еще не удалось восстановить (проблема с сетью или загрузкой); при более позднем запуске можно повторить попытку. Вы сейчас находитесь на {1}.",
        "updateRolledBack": "Последнее обновление не прошло проверку при запуске и автоматически восстановило {0}.",
        "previousVersion": "предыдущая версия",
        "product": "DSH-Portable",
        "productHint": "Хост рабочего стола, портативная среда выполнения и интеграция.",
        "engine": "DeepSeek Harness",
        "engineHint": "Официальное ядро обновляется самостоятельно. Выберите совместимую проверенную версию.",
        "startupCheck": "Проверка при запуске",
        "checkUpdate": "Проверьте наличие обновлений",
        "installVersion": "Установить выбранную версию",
        "versionChoice": "Версия ядра",
        "engineDowngradeHint": "Выбранный движок старше текущего. Сеансы, созданные с помощью более новой версии движка, могут не открываться в более старой версии; ничего не удаляется, а переключение обратно восстанавливает доступ.",
        "productVersionChoice": "Версия Portable",
        "noProductVersions": "Других квалифицированных версий нет.",
        "currentVersion": "Текущий {0}",
        "current": "На этом канале нет обновлений",
        "available": "{0} доступен для установки здесь.",
        "currentTag": "{0} (текущий)",
        "testCoreTag": "{0} (официальная тестовая сборка)",
        "installUpdate": "Установить обновление",
        "updateFromFile": "Обновление из файла",
        "getUpdateFiles": "Получить файлы",
        "getUpdateFilesHint": "Выберите папку для загрузки и проверьте JSON, подпись и ZIP для последующего обновления из файла.",
        "desktopRequired": "Откройте окно портативного рабочего стола, чтобы установить обновления.",
        "incompatible": "Для этого ядра сначала требуется соответствующая портативная версия.",
        "awaitingQualification": "Это ядро все еще тестируется. Вам не нужно ничего делать; он появится в списке, когда пройдет. Проверьте наличие обновлений позже.",
        "engineFollowsProduct": "Соответствующее обновление ядра пока недоступно. Пожалуйста, повторите попытку позже.",
        "channelUnpublished": "Пакет обновлений пока недоступен. Пожалуйста, повторите попытку позже.",
        "updateUnavailable": "Служба обновлений сейчас недоступна. Проверьте свою сеть или прокси-сервер и повторите попытку позже.",
        "updateBusy": "Еще одна проверка обновлений все еще выполняется; попробуйте еще раз через минуту.",
        "engineUnavailableSummary": "{0} более новые версии ядра пока нельзя выбрать; откройте, чтобы понять, почему.",
        "engineUnavailableCoreIncompatible": "Версия {0}: сначала обновите Portable до {1}, чтобы использовать эту базовую версию.",
        "engineUnavailableCoreAwaiting": "Версия {0}: новое ядро должно пройти тестирование, прежде чем его можно будет использовать с этим портативным компьютером. Вам не нужно ничего делать; он появится в списке выше, когда пройдет.",
        "engineUnavailableFullPackage": "Версия {0}: требуется соответствующий полный пакет Portable.",
        "engineUnavailableWrongPlatform": "Версия {0}: недоступна для этой системы.",
        "engineUnavailableUnknown": "Версия {0}: совместимость с этой версией не проверена.",
        "unknown": "Неизвестно",
        "engineCatalogInvalid": "Ответ каталога двигателей недействителен.",
        "notifications": "Уведомления о задачах",
        "notificationsHint": "Показывать системное уведомление, когда фоновая задача завершается или требует ответа или одобрения.",
        "notificationsSystemDisabled": "Уведомления Windows отключены. Разрешите им получать фоновые уведомления о завершении и внимания.",
        "updateReady": "Доступно обновление",
        "environmentActive": "Текущая изолированная среда: {0}",
        "desktop": "Поведение рабочего стола",
        "close": "При закрытии окна",
        "tray": "Свернуть в трей",
        "exit": "Выйти из приложения",
        "environments": "Окружающая среда",
        "environmentTitle": "Изолированные среды",
        "environmentHint": "В каждой среде хранятся отдельные сеансы, настройки, учетные данные, плагины и рабочее пространство. Открытие другой среды не прерывает эту.",
        "defaultEnvironment": "Среда по умолчанию",
        "newEnvironment": "Новая среда",
        "environmentName": "Имя среды",
        "createEnvironment": "Создать и открыть",
        "environmentOpened": "Открыто {0}",
        "on": "Вкл.",
        "off": "Выкл.",
        "care": "Техническое обслуживание",
        "maintenance": "Проверка и восстановление",
        "maintenanceHint": "Проверка не изменяет файлы. Восстановление пересоздаёт только восстанавливаемые компоненты при следующем запуске.",
        "community": "Помощь и обратная связь",
        "repository": "Репозиторий проекта",
        "reportProblem": "Сообщить о проблеме",
        "suggestIdea": "Предложить идею",
        "starProject": "Поддержать звездой",
        "communityHint": "Открывает GitHub для просмотра и отправки. Журналы и сеансы не загружаются автоматически.",
        "check": "Запустить проверку",
        "checking": "Проверка…",
        "healthy": "Проблем не обнаружено",
        "issues": "Обнаружено {0} проблем",
        "repair": "Восстановить при следующем запуске",
        "scheduled": "Запланировано на следующий запуск",
        "repaired": "Предыдущее восстановление завершено",
        "fullPackage": "Файлы программы неполные. Сохраните эту папку; извлеките полный пакет в новую папку, а затем перенесите данные.",
        "clearWebCache": "Очистить веб-кеш",
        "webCacheCleared": "Веб-кэш очищен. Состояние входа и локальные данные были сохранены.",
        "storageUsage": "Просмотр использования хранилища",
        "storagePartial": "Частичные итоги: ограничение сканирования или нечитаемые каталоги.",
        "storageClean": "Очистить старые среды выполнения и журналы",
        "storageCleanResult": "Удалены старые основные среды выполнения: {0}, старые среды выполнения WebView: {2} и журналы с истекшим сроком действия ({1}).",
        "storageCleanPartial": "Некоторые элементы заняты или не могут быть обработаны. Повторите попытку позже.",
        "storageCleanProtected": "Зависимости плагинов, данные для входа и резервные копии для восстановления сохраняются.",
        "storageCleanFailed": "Некоторая очистка не удалась. Запустите проверку или экспортируйте отчет поддержки.",
        "storageCleanRuntime": "Основная среда выполнения",
        "storageCleanWebView": "среда выполнения веб-представления",
        "storageCleanLogs": "Журналы",
        "dependencyClean": "Очистить кеш зависимостей плагинов",
        "dependencyCleaning": "Защита установленных и восстановленных версий, а затем очистка зависимостей…",
        "dependencyCleanResult": "Очищены кэши зависимостей в средах {0}; Сохраненные ссылки {1} прошли автономную проверку восстановления.",
        "dependencyCleanBlocked": "Очистка не завершена. Установленные плагины и материалы для восстановления были сохранены. Завершите другие установки или обновления и повторите попытку; экспортируйте отчет о поддержке, если он сохраняется.",
        "dependencyCleanExternal": "Не удалось проверить локальный источник плагина. Установленные плагины и материалы для восстановления были сохранены.",
        "storageNames": "Зависимости плагина / Импорт резервных копий / Резервные копии для восстановления / Журналы",
        "storageProtected": "Размеры файлов могут отличаться от используемого дискового пространства. Зависимости поддерживают запуск плагинов и автономное восстановление. Резервные копии не являются кэшами и сохраняются.",
        "report": "Экспорт отчёта для поддержки",
        "more": "Подробнее",
        "cancel": "Отмена",
        "exported": "Отчет службы поддержки сохранен: {0}",
        "failed": "Операция не удалась: {0}",
        "data": "Данные",
        "dataTitle": "Миграция и резервное копирование",
        "dataHint": "Экспортирует выбранное содержимое; кэши, файлы среды выполнения и рабочей области остаются в стороне.",
        "dataScope": "Содержимое миграции",
        "dataFull": "Полная миграция (включая плагины и учетные данные)",
        "dataOnly": "Только сеансы и настройки (без плагинов и учетных данных)",
        "dataStandard": "Экспортный пакет миграции",
        "dataStandardHint": "Не зашифрован; используйте его только между устройствами, которым вы доверяете.",
        "dataPlainCredentialsWarning": "Примечание. Этот стандартный файл содержит ваши учетные данные API без шифрования, поэтому любой, кто получит файл, сможет их использовать. Предпочитайте шифрование пароля или выберите только сеансы и настройки.",
        "dataPrivate": "Экспортировать зашифрованный частный пакет",
        "dataPrivateHint": "Содержит те же данные и требует для восстановления своего пароля.",
        "dataPrivateDialogHint": "Установите пароль восстановления для сеансов, настроек, плагинов и учетных данных API. DSH-Portable никогда не сохраняет его.",
        "dataPassword": "Пароль (8+ символов)",
        "dataPasswordConfirm": "Подтвердите пароль",
        "dataPasswordMismatch": "Пароли не совпадают.",
        "chooseSaveLocation": "Выберите, где сохранить пакет, прежде чем начнется экспорт.",
        "exportNow": "Выберите местоположение и экспортируйте",
        "dataSaved": "Пакет данных сохранен: {0}",
        "dataImport": "Импортировать пакет данных",
        "dataImportHint": "Выберите пакет, экспортированный другим DSH-Portable. Его содержимое проверяется перед импортом.",
        "dataImportPassword": "Введите пароль пакета",
        "dataImportPasswordHint": "Этот пакет зашифрован. Пароль используется только для этого импорта и никогда не сохраняется.",
        "dataImportReview": "Подтвердить импорт",
        "dataImportReviewHint": "Импортируйте файлы ({0}). Файлы пакетов заменяют конфликты, и автоматически создается резервная копия отката.",
        "dataImportCategories": "Включает: {0}",
        "dataImportFiles": "Файлы",
        "dataImportMoreFiles": "ещё {0} файл(ов)",
        "dataImportRestart": "Перезагрузить и импортировать",
        "dataImporting": "Перезапуск импорта…"
      },
      "pt": {
        "title": "Área de trabalho e dados",
        "invalidResult": "A operação retornou um resultado incompleto. Tente novamente ou exporte um relatório de suporte.",
        "dataExport": "Exportar dados",
        "exportFormat": "Proteção",
        "exportPlain": "Arquivo padrão",
        "exportEncrypted": "Criptografado por senha",
        "continue": "Continuar",
        "updates": "Atualizações",
        "updateRecovery": "Se uma nova versão não puder ser iniciada normalmente, o programa anterior será restaurado automaticamente enquanto as sessões, configurações, plug-ins e espaços de trabalho permanecerão intactos. As verificações de atualização estão desativadas por padrão e só são executadas quando você clica nelas; você pode ativar uma verificação de inicialização acima.",
        "startupCheckProduct": "Verificar atualizações do Portable ao iniciar",
        "startupCheckEngine": "Verificar atualizações do núcleo ao iniciar",
        "installVersionNamed": "Instalar {0}",
        "productDowngradeHint": "O portátil selecionado é mais antigo que o atual. Após o downgrade, o mecanismo que você escolheu pode não ser restaurável por enquanto; nada é excluído.",
        "coreRestoreWaiting": "O núcleo {0} ainda aguarda validação para este Portable. Após a aprovação, uma próxima inicialização poderá restaurá-lo pela rede. Por enquanto, a versão em uso é {1}.",
        "coreRestoreRetry": "O mecanismo escolhido {0} ainda não pôde ser restaurado (problema de rede ou download); um início posterior pode tentar novamente. Você está em {1} por enquanto.",
        "updateRolledBack": "A última atualização falhou na verificação de inicialização e restaurou {0} automaticamente.",
        "previousVersion": "a versão anterior",
        "product": "DSH-Portable",
        "productHint": "Host de desktop, tempo de execução portátil e integrações.",
        "engine": "DeepSeek Harness",
        "engineHint": "O núcleo oficial é atualizado de forma independente. Escolha uma versão verificada e compatível.",
        "startupCheck": "Verificar ao iniciar",
        "checkUpdate": "Verificar atualizações",
        "installVersion": "Instalar a versão selecionada",
        "versionChoice": "Versão do núcleo",
        "engineDowngradeHint": "O mecanismo selecionado é mais antigo que o atual. As sessões criadas com um mecanismo mais recente podem não abrir em um mecanismo mais antigo; nada é excluído e voltar restaura o acesso.",
        "productVersionChoice": "Versão do Portable",
        "noProductVersions": "Nenhuma outra versão qualificada está disponível.",
        "currentVersion": "Atual {0}",
        "current": "Nenhuma atualização disponível neste canal",
        "available": "{0} está disponível para instalação aqui.",
        "currentTag": "{0} (atual)",
        "testCoreTag": "{0} (compilação de teste oficial)",
        "installUpdate": "Instalar atualização",
        "updateFromFile": "Atualizar do arquivo",
        "getUpdateFiles": "Obter arquivos",
        "getUpdateFilesHint": "Escolha uma pasta para baixar e verifique o JSON, a assinatura e o ZIP para uma atualização posterior do arquivo.",
        "desktopRequired": "Abra a janela da área de trabalho portátil para instalar atualizações.",
        "incompatible": "Este núcleo precisa primeiro de uma versão portátil correspondente.",
        "awaitingQualification": "Este núcleo ainda está sendo testado. Você não precisa fazer nada; ele aparecerá na lista quando for aprovado. Verifique se há atualizações novamente mais tarde.",
        "engineFollowsProduct": "Nenhuma atualização principal correspondente está disponível ainda. Por favor, tente novamente mais tarde.",
        "channelUnpublished": "Nenhum pacote de atualização está disponível ainda. Por favor, tente novamente mais tarde.",
        "updateUnavailable": "O serviço de atualização não está disponível no momento. Verifique sua rede ou proxy e tente novamente mais tarde.",
        "updateBusy": "Outra verificação de atualização ainda está em execução; tente novamente em um momento.",
        "engineUnavailableSummary": "{0} versões principais mais recentes ainda não podem ser selecionadas; aberto para ver por quê.",
        "engineUnavailableCoreIncompatible": "Versão {0}: atualize o Portable para {1} primeiro para usar esta versão principal.",
        "engineUnavailableCoreAwaiting": "Versão {0}: O novo núcleo deve passar no teste antes de poder ser usado com este portátil. Você não precisa fazer nada; ele aparecerá na lista acima quando for aprovado.",
        "engineUnavailableFullPackage": "Versão {0}: É necessário um pacote portátil completo correspondente.",
        "engineUnavailableWrongPlatform": "Versão {0}: Não disponível para este sistema.",
        "engineUnavailableUnknown": "Versão {0}: A compatibilidade com esta versão não foi verificada.",
        "unknown": "Desconhecido",
        "engineCatalogInvalid": "A resposta do catálogo do mecanismo é inválida.",
        "notifications": "Notificações de tarefas",
        "notificationsHint": "Mostre uma notificação do sistema quando uma tarefa em segundo plano for concluída ou precisar de resposta ou aprovação.",
        "notificationsSystemDisabled": "As notificações do Windows estão desativadas. Permita que eles recebam alertas de conclusão e atenção em segundo plano.",
        "updateReady": "Atualização disponível",
        "environmentActive": "Ambiente isolado atual: {0}",
        "desktop": "Comportamento da área de trabalho",
        "close": "Ao fechar a janela",
        "tray": "Minimizar para bandeja",
        "exit": "Sair do aplicativo",
        "environments": "Ambientes",
        "environmentTitle": "Ambientes isolados",
        "environmentHint": "Cada ambiente mantém sessões, configurações, credenciais, plug-ins e espaço de trabalho separados. Abrir outro ambiente não interrompe este.",
        "defaultEnvironment": "Ambiente padrão",
        "newEnvironment": "Novo ambiente",
        "environmentName": "Nome do ambiente",
        "createEnvironment": "Criar e abrir",
        "environmentOpened": "Aberto {0}",
        "on": "Ligado",
        "off": "Desligado",
        "care": "Manutenção",
        "maintenance": "Verificar e reparar",
        "maintenanceHint": "A verificação não altera arquivos. O reparo recria apenas componentes regeneráveis e é executado na próxima inicialização.",
        "community": "Ajuda e comentários",
        "repository": "Repositório de projetos",
        "reportProblem": "Informar um problema",
        "suggestIdea": "Sugira uma ideia",
        "starProject": "Deixe uma estrela",
        "communityHint": "Abre o GitHub para você revisar e enviar. Logs e sessões não são carregados automaticamente.",
        "check": "Executar verificação",
        "checking": "Verificando…",
        "healthy": "Nenhum problema encontrado",
        "issues": "{0} problemas encontrados",
        "repair": "Reparar ao iniciar",
        "scheduled": "Programado para o próximo início",
        "repaired": "O último reparo concluído",
        "fullPackage": "Os arquivos do programa estão incompletos. Guarde esta pasta; extraia um pacote completo para uma nova pasta e migre seus dados.",
        "clearWebCache": "Limpar cache da web",
        "webCacheCleared": "Cache da Web limpo. O estado de login e os dados locais foram preservados.",
        "storageUsage": "Ver uso de armazenamento",
        "storagePartial": "Totais parciais: limite de varredura ou diretórios ilegíveis.",
        "storageClean": "Limpe tempos de execução e logs antigos",
        "storageCleanResult": "Foram removidos {0} tempos de execução principais antigos, {2} tempos de execução antigos do WebView e {1} registros expirados.",
        "storageCleanPartial": "Alguns itens estão ocupados ou não puderam ser processados. Tente novamente mais tarde.",
        "storageCleanProtected": "As dependências de plug-in, os dados de login e os backups de recuperação são mantidos.",
        "storageCleanFailed": "Alguma limpeza falhou. Execute uma verificação ou exporte um relatório de suporte.",
        "storageCleanRuntime": "Tempo de execução principal",
        "storageCleanWebView": "Tempo de execução do WebView",
        "storageCleanLogs": "Registros",
        "dependencyClean": "Limpe o cache de dependência do plugin",
        "dependencyCleaning": "Protegendo versões instaladas e de recuperação e, em seguida, limpando dependências…",
        "dependencyCleanResult": "Caches de dependência limpos em {0} ambientes; {1} referências retidas passaram nas verificações de reconstrução off-line.",
        "dependencyCleanBlocked": "A limpeza não foi concluída. Plugins instalados e material de recuperação foram mantidos. Conclua outras instalações ou atualizações e tente novamente; exporte um relatório de suporte se persistir.",
        "dependencyCleanExternal": "Não foi possível verificar uma fonte de plug-in local. Plugins instalados e material de recuperação foram mantidos.",
        "storageNames": "Dependências de plug-in/Importar backups/Backups de recuperação/Logs",
        "storageProtected": "Os tamanhos dos arquivos podem diferir do espaço em disco usado. As dependências suportam a execução de plug-ins e recuperação offline. Os backups não são caches e são retidos.",
        "report": "Exportar relatório de suporte",
        "more": "Mais",
        "cancel": "Cancelar",
        "exported": "Relatório de suporte salvo: {0}",
        "failed": "Falha na operação: {0}",
        "data": "Dados",
        "dataTitle": "Migração e backup",
        "dataHint": "Exporta o conteúdo selecionado; caches, tempos de execução e arquivos de espaço de trabalho ficam de fora.",
        "dataScope": "Conteúdo de migração",
        "dataFull": "Migração completa (incluindo plugins e credenciais)",
        "dataOnly": "Apenas sessões e configurações (sem plugins ou credenciais)",
        "dataStandard": "Exportar pacote de migração",
        "dataStandardHint": "Não criptografado; use-o apenas entre dispositivos em que você confia.",
        "dataPlainCredentialsWarning": "Observação: este arquivo padrão contém suas credenciais de API sem criptografia, portanto, qualquer pessoa que obtiver o arquivo poderá usá-las. Prefira criptografia de senha ou escolha apenas sessões e configurações.",
        "dataPrivate": "Exportar pacote privado criptografado",
        "dataPrivateHint": "Contém os mesmos dados e requer sua senha para restauração.",
        "dataPrivateDialogHint": "Defina uma senha de recuperação para sessões, configurações, plug-ins e credenciais de API. DSH-Portable nunca o armazena.",
        "dataPassword": "Senha (8+ caracteres)",
        "dataPasswordConfirm": "Confirmar senha",
        "dataPasswordMismatch": "As senhas não coincidem.",
        "chooseSaveLocation": "Escolha onde salvar o pacote antes do início da exportação.",
        "exportNow": "Escolha o local e exporte",
        "dataSaved": "Pacote de dados salvo: {0}",
        "dataImport": "Importar pacote de dados",
        "dataImportHint": "Escolha um pacote exportado por outro DSH-Portable. Seu conteúdo é verificado antes da importação.",
        "dataImportPassword": "Digite a senha do pacote",
        "dataImportPasswordHint": "Este pacote está criptografado. A senha é usada apenas para esta importação e nunca é armazenada.",
        "dataImportReview": "Confirmar importação",
        "dataImportReviewHint": "Importe {0} arquivo(s). Os arquivos do pacote substituem os conflitos e um backup de reversão é criado automaticamente.",
        "dataImportCategories": "Inclui: {0}",
        "dataImportFiles": "Arquivos",
        "dataImportMoreFiles": "{0} mais arquivos",
        "dataImportRestart": "Reinicie e importe",
        "dataImporting": "Reiniciando a importação…"
      }
    }

    function format(template, ...values) {
      return String(template).replace(/\{(\d+)\}/g, (_match, index) => String(values[index] ?? ''))
    }

    // Official alpha and beta cores are test builds; rc and final releases are labelled by number only.
    const isTestCore = version => /-(?:alpha|beta)\.\d+$/.test(String(version))
    // Update errors are shown to people, not developers: network and catalog problems get one plain sentence and the
    // raw detail stays in the log. Messages that are already plain (busy, desktop required) pass through.
    function updateErrorText(t, error) {
      const message = String(error?.message || error || '')
      if (/another update check is still running/i.test(message)) return t('updateBusy')
      if (/HTTP \d{3}|fetch failed|timed? ?out|ENOTFOUND|ECONN|EAI_AGAIN|certificate|untrusted|invalid .*(response|catalog|manifest)|unexpected token|JSON/i.test(message)) return t('updateUnavailable')
      return format(t('failed'), message)
    }
    function compareCoreVersions(left, right) {
      const parse = version => {
        const [core, pre = ''] = String(version).split('-')
        const [tag = '', number = '0'] = pre.split('.')
        return [...core.split('.').map(Number), pre ? ['alpha', 'beta', 'rc'].indexOf(tag) : 3, Number(number)]
      }
      const a = parse(left), b = parse(right)
      for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return a[index] - b[index]
      return 0
    }

    let dataExportRequestSequence = 0
    const pendingDataExportRequests = new Map()
    const pendingDataImportRequests = new Map()
    const pendingHostRestartRequests = new Map()
    const pendingEnvironmentRequests = new Map()

    const completeHostCapabilities = Object.freeze({
      pickDirectory: true,
      saveDataPackage: true,
      openDataPackage: true,
      importData: true,
      restartHost: true,
      openEnvironment: false,
      openUpdate: false,
      openUpdateFromFile: false,
      prepareOfflineUpdateFiles: false,
      preferences: true,
      sessionProjection: true,
      clearWebCache: false,
    })

    const webView2HostCapabilities = Object.freeze({
      ...completeHostCapabilities,
      openEnvironment: true,
      openUpdate: true,
    })

    function nativeHostTransport() {
      const native = window.__DSH_PORTABLE_NATIVE__
      const hasProtocolVersion = native != null && Object.prototype.hasOwnProperty.call(native, 'protocolVersion')
      if (hasProtocolVersion && native.protocolVersion !== 1) return null
      if (hasProtocolVersion && ['postMessage', 'addEventListener', 'removeEventListener'].some(name => typeof native[name] !== 'function')) return null
      if (native?.postMessage && native?.addEventListener) {
        if (hasProtocolVersion) {
          const capabilities = {}
          const advertised = native.capabilities || {}
          for (const name of Object.keys(completeHostCapabilities)) capabilities[name] = advertised[name] === true
          return { bridge: native, capabilities: Object.freeze(capabilities) }
        }
        return {
          bridge: native,
          capabilities: Object.freeze({ ...completeHostCapabilities, ...(native.capabilities || {}) }),
        }
      }
      const webview = window.chrome?.webview
      if (webview?.postMessage && webview?.addEventListener) {
        return {
          bridge: webview,
          capabilities: Object.freeze({
            ...webView2HostCapabilities,
            clearWebCache: window.__DSH_PORTABLE_WEB_CACHE__ === true,
          }),
        }
      }
      return null
    }

    function postToNativeHost(message, capability) {
      const host = nativeHostTransport()
      if (!host || host.capabilities[capability] !== true) return false
      host.bridge.postMessage(message)
      return true
    }

    function chooseDataExportPath(kind) {
      const host = nativeHostTransport()
      if (!host || host.capabilities.saveDataPackage !== true) return Promise.resolve('')
      return new Promise((resolve, reject) => {
        const requestId = `data-export-${Date.now().toString(36)}-${++dataExportRequestSequence}`
        pendingDataExportRequests.set(requestId, { resolve, reject })
        try { host.bridge.postMessage({
          type: 'dsh-portable/pick-data-export',
          schemaVersion: 1,
          requestId,
          kind,
        }) } catch (error) {
          pendingDataExportRequests.delete(requestId)
          reject(error)
        }
      })
    }

    function clearWebCache() {
      const host = nativeHostTransport()
      if (!host || host.capabilities.clearWebCache !== true) return Promise.reject(new Error('Web cache maintenance is unavailable.'))
      const bridge = host.bridge
      return new Promise((resolve, reject) => {
        const requestId = `web-cache-${Date.now().toString(36)}-${++dataExportRequestSequence}`
        let settled = false
        const finish = error => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          bridge.removeEventListener('message', receive)
          window.removeEventListener?.('pagehide', cancel)
          error ? reject(error) : resolve()
        }
        const cancel = () => {
          const error = new Error('Portable page closed before web cache cleanup was confirmed.')
          error.code = 'REQUEST_CANCELLED'
          finish(error)
        }
        const receive = event => {
          if (event.data?.type !== 'dsh-portable/clear-web-cache-result' || event.data.requestId !== requestId) return
          finish(event.data.ok ? null : new Error(event.data.error || 'Web cache cleanup failed.'))
        }
        const timer = setTimeout(() => finish(new Error('Web cache cleanup has not been confirmed.')), 30000)
        try {
          bridge.addEventListener('message', receive)
          window.addEventListener?.('pagehide', cancel)
          bridge.postMessage({ type: 'dsh-portable/clear-web-cache', requestId })
        } catch (error) { finish(error) }
      })
    }

    function chooseDataImportPath() {
      const host = nativeHostTransport()
      if (!host || host.capabilities.openDataPackage !== true) return Promise.resolve(null)
      return new Promise((resolve, reject) => {
        const requestId = `data-import-${Date.now().toString(36)}-${++dataExportRequestSequence}`
        pendingDataImportRequests.set(requestId, { resolve, reject })
        try { host.bridge.postMessage({ type: 'dsh-portable/pick-data-import', schemaVersion: 1, requestId }) } catch (error) {
          pendingDataImportRequests.delete(requestId)
          reject(error)
        }
      })
    }

    function restartPortableHost() {
      const host = nativeHostTransport()
      if (!host || host.capabilities.restartHost !== true) return Promise.reject(new Error('Portable restart is unavailable on this host.'))
      return new Promise((resolve, reject) => {
        const requestId = `host-restart-${Date.now().toString(36)}-${++dataExportRequestSequence}`
        const timeout = setTimeout(() => {
          pendingHostRestartRequests.delete(requestId)
          const error = new Error('Portable restart request timed out before the host reply was received.')
          error.code = 'DSH_PORTABLE_RESTART_UNCONFIRMED'
          reject(error)
        }, 10000)
        pendingHostRestartRequests.set(requestId, {
          resolve: value => { clearTimeout(timeout); resolve(value) },
          reject: error => { clearTimeout(timeout); reject(error) },
        })
        try {
          host.bridge.postMessage({ type: 'dsh-portable/restart-host', schemaVersion: 1, requestId })
        } catch (cause) {
          pendingHostRestartRequests.delete(requestId)
          clearTimeout(timeout)
          const error = new Error('Portable restart request could not be confirmed by the host.', { cause })
          error.code = 'DSH_PORTABLE_RESTART_UNCONFIRMED'
          reject(error)
        }
      })
    }

    function openPortableEnvironment(environment) {
      const host = nativeHostTransport()
      if (!host || host.capabilities.openEnvironment !== true) return Promise.reject(new Error('Portable environments are unavailable on this host.'))
      return new Promise((resolve, reject) => {
        const requestId = `environment-open-${Date.now().toString(36)}-${++dataExportRequestSequence}`
        const timeout = setTimeout(() => {
          pendingEnvironmentRequests.delete(requestId)
          reject(new Error('Portable environment did not open in time.'))
        }, 10000)
        pendingEnvironmentRequests.set(requestId, {
          resolve: value => { clearTimeout(timeout); resolve(value) },
          reject: error => { clearTimeout(timeout); reject(error) },
        })
        try { host.bridge.postMessage({ type: 'dsh-portable/open-environment', schemaVersion: 1, requestId, environment }) } catch (error) {
          pendingEnvironmentRequests.delete(requestId)
          clearTimeout(timeout)
          reject(error)
        }
      })
    }

    function PortableSelector({ value, items, onSelect, label, primitives, disabled = false }) {
      const h = React.createElement
      const [open, setOpen] = React.useState(false)
      const selected = items.find(item => item.id === value)
      const anchor = h('button', {
        type: 'button', className: 'dshPortableSelector', 'aria-label': label, disabled,
        'aria-haspopup': 'menu', 'aria-expanded': open,
        onClick: () => setOpen(current => !current),
      }, selected?.label || value, h(primitives.IconChevronDownOutline14, { className: 'dshPortableSelectorChevron' }))
      return h(primitives.Menu, {
        open: open && !disabled, anchor, items, selectedId: value, align: 'end', portal: true,
        onClose: () => setOpen(false),
        onSelect: id => { setOpen(false); if (!disabled) onSelect(id) },
      })
    }

    let portableShellSummary = null
    let portableShellSummaryPromise = null
    const portableShellSummaryListeners = new Set()

    function loadPortableShellSummary() {
      if (portableShellSummaryPromise) return portableShellSummaryPromise
      if (portableShellSummary) return Promise.resolve(portableShellSummary)
      portableShellSummaryPromise = fetch('/dsh-portable/settings', { cache: 'no-store', headers: { 'x-dsh-portable-settings': 'local-only' } })
        .then(async response => {
          if (!response.ok) throw new Error('Portable settings unavailable')
          return response.json()
        })
        .then(async body => {
          // Local environment identity must not wait for network update checks.
          portableShellSummary = { environments: body.environments, availableScopes: [] }
          for (const listener of portableShellSummaryListeners) listener(portableShellSummary)
          const enabled = [
            body.settings?.productUpdateCheckEnabled ? 'product' : '',
            body.settings?.engineUpdateCheckEnabled ? 'engine' : '',
          ].filter(Boolean)
          const checks = await Promise.all(enabled.map(scope => fetch('/dsh-portable/check-update', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope, background: true }),
          }).then(response => response.json()).catch(() => null)))
          portableShellSummary = {
            environments: body.environments,
            availableScopes: enabled.filter((_scope, index) => ['available', 'full-package-required'].includes(checks[index]?.status)),
          }
          for (const listener of portableShellSummaryListeners) listener(portableShellSummary)
          return portableShellSummary
        })
        .catch(() => {
          portableShellSummary = { environments: null, availableScopes: [] }
          for (const listener of portableShellSummaryListeners) listener(portableShellSummary)
          return portableShellSummary
        })
        .finally(() => { portableShellSummaryPromise = null })
      return portableShellSummaryPromise
    }

    function usePortableShellSummary() {
      const [summary, setSummary] = React.useState(() => portableShellSummary)
      React.useEffect(() => {
        let active = true
        const update = value => { if (active) setSummary(value) }
        portableShellSummaryListeners.add(update)
        if (portableShellSummary) update(portableShellSummary)
        loadPortableShellSummary().then(update)
        return () => { active = false; portableShellSummaryListeners.delete(update) }
      }, [])
      return summary
    }

    function PortableUpdateAction({ wide, primitives, ctx }) {
      const h = React.createElement
      const summary = usePortableShellSummary()
      const scopes = summary?.availableScopes || []
      if (scopes.length === 0) return null
      const lang = useLocale(ctx)
      const label = copy[lang].updateReady
      return h('div', { className: 'dshPortableFooterUpdate' },
        h(primitives.Tooltip, { label, side: 'top' }, h('button', {
          type: 'button', className: 'dshPortableFooterUpdateButton', 'aria-label': label,
          onClick: () => postToNativeHost({ type: 'dsh-portable/open-update', schemaVersion: 1, scope: scopes.includes('product') ? 'product' : 'engine' }, 'openUpdate'),
        }, h(primitives.IconDownloadOutline16, { size: 16 }), h('span', { className: 'dshPortableUpdateDot', 'aria-hidden': true }))))
    }

    function PortableEnvironmentChip({ primitives, ctx }) {
      const h = React.createElement
      const summary = usePortableShellSummary()
      const environments = summary?.environments
      if (!environments || environments.current === 'default') return null
      const current = environments.items?.find(item => item.id === environments.current)
      const name = current?.name || environments.current
      const lang = useLocale(ctx)
      const label = format(copy[lang].environmentActive, name)
      return h('span', { className: 'dshPortableEnvironmentChip', title: label, 'aria-label': label },
        h(primitives.IconFolderOpenOutline16, { size: 14 }), h('span', null, name))
    }

    function PortableSettings(ctx, primitives, page = 'portable') {
      const h = React.createElement
      const useEffect = React.useEffect
      const useState = React.useState
      const lang = useLocale(ctx)
      const t = key => copy[lang][key] || key
      const coreLabel = version => isTestCore(version) ? format(t('testCoreTag'), version) : version
      const [settings, setSettings] = useState(null)
      const [versions, setVersions] = useState({ portable: '', engine: '' })
      const [lastUpdate, setLastUpdate] = useState(null)
      const [coreRestore, setCoreRestore] = useState(null)
      const [updateOffers, setUpdateOffers] = useState({})
      const [notificationAvailability, setNotificationAvailability] = useState('unknown')
      const [productVersions, setProductVersions] = useState([])
      const [productCatalogLoaded, setProductCatalogLoaded] = useState(false)
      const [productVersion, setProductVersion] = useState('')
      const productRequestSequenceRef = React.useRef(0)
      const [engineVersions, setEngineVersions] = useState([])
      const [engineVersion, setEngineVersion] = useState('')
      const [engineVersionManifestUrls, setEngineVersionManifestUrls] = useState({})
      const [engineUnavailable, setEngineUnavailable] = useState([])
      const [persistedChannel, setPersistedChannel] = useState('')
      const [selectedChannel, setSelectedChannel] = useState('')
      const [catalogRevision, setCatalogRevision] = useState(0)
      const [environments, setEnvironments] = useState({ current: 'default', items: [{ id: 'default', name: '' }] })
      const [busy, setBusy] = useState('')
      const [messages, setMessages] = useState({})
      const [dataScope, setDataScope] = useState('full')
      const [exportKind, setExportKind] = useState('private')
      const [privatePassword, setPrivatePassword] = useState('')
      const [privatePasswordConfirm, setPrivatePasswordConfirm] = useState('')
      const [importPassword, setImportPassword] = useState('')
      const [importState, setImportState] = useState(null)
      const [maintenanceMenuOpen, setMaintenanceMenuOpen] = useState(false)
      const [dataDialog, setDataDialog] = useState('')
      const [environmentDialog, setEnvironmentDialog] = useState(false)
      const [environmentName, setEnvironmentName] = useState('')
      const [settingsSaving, setSettingsSaving] = useState(false)
      const environmentsSupported = nativeHostTransport()?.capabilities.openEnvironment === true
      const statusRefs = React.useRef({})
      const confirmedSettingsRef = React.useRef(null)
      const persistedChannelRef = React.useRef('')
      const settingsSavingRef = React.useRef(false)
      const catalogInvalidatedRef = React.useRef(false)
      const settingsSaveQueueRef = React.useRef(Promise.resolve())
      const settingsSaveSequenceRef = React.useRef(0)
      const engineVersionsRequestSequenceRef = React.useRef(0)
      const updateRequestSequenceRef = React.useRef(0)
      const setStatus = (key, value) => {
        setMessages(current => ({ ...current, [key]: value }))
        if (value) requestAnimationFrame(() => statusRefs.current[key]?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }))
      }
      useEffect(() => {
        let active = true
        fetch('/dsh-portable/settings', { cache: 'no-store', headers: { 'x-dsh-portable-settings': 'local-only' } })
          .then(async response => {
            const body = await response.json()
            if (!response.ok || body?.error || !body?.settings) throw new Error(body?.error || `Invalid settings response (HTTP ${response.status})`)
            return body
          }).then(body => {
            if (!active) return
            const confirmedSettings = body.settings && { ...body.settings, updateChannel: 'stable' }
            confirmedSettingsRef.current = confirmedSettings
            setSettings(confirmedSettings)
            const channel = 'stable'
            persistedChannelRef.current = channel
            setPersistedChannel(channel)
            setSelectedChannel(channel)
            setVersions(body.versions || { portable: '', engine: '' })
            setLastUpdate(body.lastUpdate || null)
            setCoreRestore(body.coreRestore || null)
            setNotificationAvailability(body.notificationAvailability?.status || 'unknown')
            if (body.environments) setEnvironments(body.environments)
            if (body.lastRepair?.needsFullPackage) setStatus('maintenance', t('fullPackage'))
            else if (body.lastRepair?.ok) setStatus('maintenance', t('repaired'))
            if (page !== 'updates' && body.notificationAvailability?.status === 'unknown') {
              // This supplementary OS query must never delay rendering saved settings.
              fetch('/dsh-portable/notification-status', { cache: 'no-store' })
                .then(response => response.ok ? response.json() : null)
                .then(value => { if (active && typeof value?.status === 'string') setNotificationAvailability(value.status) })
                .catch(() => {})
            }
          })
          .catch(error => { if (active) setStatus('portable', format(t('failed'), error.message || error)) })
        return () => { active = false }
      }, [])
      useEffect(() => {
        let active = true
        const requestSequence = ++engineVersionsRequestSequenceRef.current
        const current = () => active && requestSequence === engineVersionsRequestSequenceRef.current
        setEngineVersions([])
        setEngineVersion('')
        setEngineVersionManifestUrls({})
        setEngineUnavailable([])
        setStatus('update-engine', '')
        if (page !== 'updates' || !settings || !persistedChannel) return () => { active = false }
        fetch('/dsh-portable/engine-versions', { cache: 'no-store' }).then(async response => {
          let body
          try { body = await response.json() }
          catch (cause) { throw new Error(response.ok ? `Invalid engine version response: ${cause?.message || cause}` : `HTTP ${response.status}`) }
          if (!response.ok || body?.error) throw new Error(body?.error || `HTTP ${response.status}`)
          if (body?.schemaVersion !== 1 || !Array.isArray(body?.versions)) throw new Error(t('engineCatalogInvalid'))
          if (body.releaseChannel !== 'stable') throw new Error(t('engineCatalogInvalid'))
          return body
        }).then(body => {
          if (!current()) return
          if (body.status === 'channel-unpublished') setStatus('update-engine', t('engineFollowsProduct'))
          const items = Array.isArray(body.versions) ? body.versions : []
          const unavailable = Array.isArray(body.unavailable) ? body.unavailable
            .filter(item => item && item.version && String(item.version) !== String(body.current || ''))
            .map(item => ({
              version: String(item.version),
              status: String(item.status || ''),
              reason: String(item.reason || ''),
              requiredPortableVersion: String(item.requiredPortableVersion || ''),
            })) : []
          setEngineVersions(items)
          setEngineVersion(body.current || '')
          setEngineVersionManifestUrls(Object.fromEntries(items.map(item => [item.version, item.manifestUrl])))
          setEngineUnavailable(unavailable)
        }).catch(error => {
          if (current()) setStatus('update-engine', updateErrorText(t, error))
        })
        return () => { active = false }
      }, [persistedChannel, catalogRevision])

      useEffect(() => {
        let active = true
        const sequence = ++productRequestSequenceRef.current
        setProductCatalogLoaded(false)
        setProductVersions([])
        setProductVersion('')
        if (page !== 'updates' || !persistedChannel) return () => { active = false }
        fetch('/dsh-portable/product-versions', { cache: 'no-store' }).then(async response => {
          const body = await response.json()
          if (!response.ok || body.error || body.schemaVersion !== 1 || body.releaseChannel !== persistedChannel || !Array.isArray(body.versions)) throw new Error(body.error || t('updateUnavailable'))
          return body
        }).then(body => {
          if (!active || sequence !== productRequestSequenceRef.current) return
          setProductVersions(body.versions)
          setProductCatalogLoaded(true)
          setProductVersion(body.current || '')
        }).catch(error => {
          if (active && sequence === productRequestSequenceRef.current) setStatus('update-product', updateErrorText(t, error))
        })
        return () => { active = false }
      }, [persistedChannel, catalogRevision])

      const update = patch => {
        const hasChannel = Object.hasOwn(patch, 'updateChannel')
        const sequence = ++settingsSaveSequenceRef.current
        settingsSavingRef.current = true
        setSettingsSaving(true)
        if (hasChannel) setSelectedChannel(patch.updateChannel)
        else setSettings(current => ({ ...current, ...patch }))
        const request = settingsSaveQueueRef.current.then(async () => {
          try {
            const response = await fetch('/dsh-portable/settings', {
              method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
            })
            let body
            try { body = await response.json() }
            catch (cause) { throw new Error(response.ok ? `Invalid settings response: ${cause?.message || cause}` : `HTTP ${response.status}`) }
            if (!response.ok || body?.error) throw new Error(body?.error || `HTTP ${response.status}`)
            if (!body?.settings || typeof body.settings !== 'object') throw new Error('Settings response is missing saved settings.')
            const previousConfirmed = confirmedSettingsRef.current || {}
            const confirmedSettings = { ...previousConfirmed, ...body.settings, updateChannel: 'stable' }
            const confirmedChannel = 'stable'
            if (confirmedChannel) confirmedSettings.updateChannel = confirmedChannel
            confirmedSettingsRef.current = confirmedSettings
            if (sequence !== settingsSaveSequenceRef.current) return
            const renderedChannel = persistedChannelRef.current
            const channelNeedsRefresh = catalogInvalidatedRef.current || hasChannel || confirmedChannel !== renderedChannel
            persistedChannelRef.current = confirmedChannel
            setPersistedChannel(confirmedChannel)
            setSelectedChannel(confirmedChannel)
            setSettings(confirmedSettings)
            if (channelNeedsRefresh) setCatalogRevision(current => current + 1)
            catalogInvalidatedRef.current = false
            postToNativeHost({ type: 'dsh-portable/preferences', schemaVersion: 1, ...confirmedSettings }, 'preferences')
            settingsSavingRef.current = false
            setSettingsSaving(false)
          } catch (error) {
            if (sequence !== settingsSaveSequenceRef.current) return
            const confirmedSettings = confirmedSettingsRef.current
            const confirmedChannel = 'stable'
            const renderedChannel = persistedChannelRef.current
            if (confirmedSettings) {
              persistedChannelRef.current = confirmedChannel
              setPersistedChannel(confirmedChannel)
              setSelectedChannel(confirmedChannel)
              setSettings({ ...confirmedSettings, updateChannel: confirmedChannel })
              if (catalogInvalidatedRef.current || hasChannel || confirmedChannel !== renderedChannel) setCatalogRevision(current => current + 1)
              catalogInvalidatedRef.current = false
            } else if (hasChannel) {
              setSelectedChannel(persistedChannelRef.current)
              setCatalogRevision(current => current + 1)
              catalogInvalidatedRef.current = false
            }
            setStatus('portable', format(t('failed'), error.message || error))
            settingsSavingRef.current = false
            setSettingsSaving(false)
          }
        })
        settingsSaveQueueRef.current = request.catch(() => {})
      }
      const unavailableMessage = item => {
        const version = item.version || t('unknown')
        const status = item.status || item.reason
        if (status === 'core-incompatible') return format(t('engineUnavailableCoreIncompatible'), version, item.requiredPortableVersion || t('unknown'))
        if (status === 'core-awaiting-qualification') return format(t('engineUnavailableCoreAwaiting'), version)
        if (status === 'full-package-required') return format(t('engineUnavailableFullPackage'), version)
        if (status === 'wrong-platform') return format(t('engineUnavailableWrongPlatform'), version)
        return format(t('engineUnavailableUnknown'), version)
      }
      const openEnvironment = async id => {
        if (id === environments.current) return
        const item = environments.items.find(candidate => candidate.id === id)
        try {
          await openPortableEnvironment(id)
          setStatus('environment', format(t('environmentOpened'), item?.name || id))
        } catch (error) { setStatus('environment', format(t('failed'), error.message || error)) }
      }
      const createEnvironment = async () => {
        if (!environmentName.trim()) return
        setBusy('environment-create')
        try {
          const response = await fetch('/dsh-portable/environments', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: environmentName }),
          })
          const body = await response.json()
          if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`)
          const nextEnvironments = { current: body.current, items: body.items }
          setEnvironments(nextEnvironments)
          setEnvironmentDialog(false)
          setEnvironmentName('')
          await openPortableEnvironment(body.created.id)
          setStatus('environment', format(t('environmentOpened'), body.created.name || body.created.id))
        } catch (error) { setStatus('environment', format(t('failed'), error.message || error)) }
        finally { setBusy('') }
      }
      const action = (name, path) => {
        setBusy(name); setStatus('maintenance', '')
        fetch(path, { method: 'POST' }).then(async res => {
          const body = await res.json()
          if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`)
          return body
        }).then(body => {
          if (name === 'doctor') {
            if (!Array.isArray(body.checks) || !body.checks.length || body.checks.some(item => !item || typeof item.status !== 'string')) throw new Error(t('invalidResult'))
            const count = body.checks.filter(item => item.status !== 'ok').length
            setStatus('maintenance', body.needsFullPackage ? t('fullPackage') : count ? format(t('issues'), count) : t('healthy'))
          } else if (name === 'repair') {
            if (body.scheduled !== true) throw new Error(t('invalidResult'))
            setStatus('maintenance', t('scheduled'))
          }
          else setStatus('maintenance', format(t('exported'), body.output || ''))
        }).catch(error => setStatus('maintenance', format(t('failed'), error.message || error))).finally(() => setBusy(''))
      }
      const exportSupportReport = async () => {
        setBusy('report'); setStatus('maintenance', '')
        try {
          const output = await chooseDataExportPath('support')
          if (!output) return
          const response = await fetch('/dsh-portable/support-report', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ output }),
          })
          const body = await response.json()
          if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`)
          if (typeof body.output !== 'string' || !body.output.trim()) throw new Error(t('invalidResult'))
          setStatus('maintenance', format(t('exported'), body.output))
        } catch (error) { setStatus('maintenance', format(t('failed'), error.message || error)) }
        finally { setBusy('') }
      }
      const selectedUpdateManifest = scope => scope === 'product'
        ? productVersion && productVersion !== versions.portable ? productVersions.find(item => item.version === productVersion)?.manifestUrl : null
        : engineVersion && engineVersion !== versions.engine ? engineVersionManifestUrls[engineVersion] : null
      const downloadUpdateFiles = scope => {
        if (settingsSavingRef.current || settingsSaving || busy) return
        const manifestUrl = selectedUpdateManifest(scope)
        if (!postToNativeHost({
          type: 'dsh-portable/open-update', schemaVersion: 1, scope, downloadFiles: true,
          ...(manifestUrl ? { manifestUrl } : {}),
        }, 'prepareOfflineUpdateFiles')) setStatus(`update-${scope}`, t('desktopRequired'))
      }
      const checkUpdate = scope => {
        if (settingsSavingRef.current || settingsSaving || busy) return
        const selectedManifest = selectedUpdateManifest(scope)
        if (selectedManifest || updateOffers[scope]) {
          if (!postToNativeHost({
            type: 'dsh-portable/open-update', schemaVersion: 1, scope,
            ...(selectedManifest ? { manifestUrl: selectedManifest } : {}),
          }, 'openUpdate')) setStatus(`update-${scope}`, t('desktopRequired'))
          return
        }
        const sequence = ++updateRequestSequenceRef.current
        const channel = persistedChannelRef.current
        const isCurrent = () => sequence === updateRequestSequenceRef.current && channel === persistedChannelRef.current
        const name = `update-${scope}`
        setBusy(name); setStatus(name, '')
        fetch('/dsh-portable/check-update', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope }),
        }).then(res => res.json()).then(body => {
          if (!isCurrent()) return
          if (body.error) throw new Error(body.error)
          if (body.status === 'current') setStatus(name, t('current'))
          else if (body.status === 'available' || body.status === 'full-package-required') {
            setUpdateOffers(current => ({ ...current, [scope]: true }))
            setStatus(name, format(t('available'), scope === 'engine' ? coreLabel(body.engineLatest || '') : body.latest || ''))
          }
          else if (body.status === 'core-awaiting-qualification') setStatus(name, t('awaitingQualification'))
          else if (body.status === 'core-incompatible') setStatus(name, t('incompatible'))
          else if (body.status === 'engine-follows-product') setStatus(name, t('engineFollowsProduct'))
          else if (body.status === 'channel-unpublished') setStatus(name, t('channelUnpublished'))
          else setStatus(name, t('updateUnavailable'))
        }).catch(error => { if (isCurrent()) setStatus(name, name.startsWith('update-') ? updateErrorText(t, error) : format(t('failed'), error.message || error)) })
          .finally(() => { if (sequence === updateRequestSequenceRef.current) setBusy('') })
      }
      const updateFromFile = scope => {
        if (settingsSavingRef.current || settingsSaving || busy) return
        if (!postToNativeHost({ type: 'dsh-portable/open-update', schemaVersion: 1, scope, offline: true }, 'openUpdateFromFile')) {
          setStatus(`update-${scope}`, t('desktopRequired'))
        }
      }
      const closePrivateDialog = () => {
        setDataDialog('')
        setPrivatePassword('')
        setPrivatePasswordConfirm('')
      }
      const closeImportDialog = () => {
        setDataDialog('')
        setImportPassword('')
        setImportState(null)
      }
      const inspectImport = async (input, password = '') => {
        const response = await fetch('/dsh-portable/data-inspect', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input, password: password || undefined }),
        })
        const body = await response.json()
        return { response, body }
      }
      const beginImport = async () => {
        setBusy('data-import')
        setStatus('data', '')
        try {
          const input = await chooseDataImportPath()
          if (!input) return
          const { response, body } = await inspectImport(input)
          if (response.status === 401 && body.requiresPassword) {
            setImportState({ input, info: null })
            setDataDialog('import-password')
            return
          }
          if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`)
          setImportState({ input, info: body })
          setDataDialog('import-confirm')
        } catch (error) { setStatus('data', format(t('failed'), error.message || error)) }
        finally { setBusy('') }
      }
      const unlockImport = async () => {
        if (!importState?.input || importPassword.length < 8) return
        setBusy('data-import')
        try {
          const { response, body } = await inspectImport(importState.input, importPassword)
          if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`)
          setImportState({ ...importState, info: body })
          setDataDialog('import-confirm')
        } catch (error) { setStatus('data', format(t('failed'), error.message || error)) }
        finally { setBusy('') }
      }
      const runImport = () => {
        const host = nativeHostTransport()
        if (!host || host.capabilities.importData !== true || !importState?.input) {
          setStatus('data', format(t('failed'), 'desktop host unavailable'))
          return
        }
        setBusy('data-import-run')
        host.bridge.postMessage({
          type: 'dsh-portable/import-data', schemaVersion: 1,
          input: importState.input, password: importPassword || undefined, conflict: 'replace',
        })
      }
      const exportData = async kind => {
        const name = `data-${kind}`
        setBusy(name)
        setStatus('data', '')
        try {
          const output = await chooseDataExportPath(kind)
          if (output === null) return
          const res = await fetch('/dsh-portable/data-export', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ kind, scope: dataScope, output: output || undefined, password: kind === 'private' ? privatePassword : undefined }),
          })
          const body = await res.json()
          if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`)
          if (typeof body.output !== 'string' || !body.output.trim()) throw new Error(t('invalidResult'))
          setStatus('data', format(t('dataSaved'), body.output || ''))
          closePrivateDialog()
        } catch (error) {
          setStatus('data', format(t('failed'), error.message || error))
        } finally {
          setBusy('')
        }
      }
      const styles = {
        group: { display: 'flex', flexDirection: 'column', padding: '0 0 8px' },
        heading: { color: 'var(--dsw-alias-label-primary)', fontSize: 14, fontWeight: 500, lineHeight: '22px', marginBottom: 0 },
        pageTitle: { color: 'var(--dsw-alias-label-primary)', fontSize: 16, fontWeight: 500, lineHeight: '24px', margin: 0 },
        section: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 20 },
        sectionHeading: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, fontWeight: 500, lineHeight: '18px', padding: 0 },
        item: { display: 'flex', gap: 8, alignItems: 'center', padding: '16px 0', borderBottom: '.5px solid var(--dsw-alias-border-l2)', flexWrap: 'wrap' },
        text: { display: 'flex', flex: '1 1 260px', minWidth: 0, flexDirection: 'column', gap: 4, paddingRight: 32 },
        label: { color: 'var(--dsw-alias-label-primary)', fontSize: 14, fontWeight: 400, lineHeight: '22px' },
        hint: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: '18px' },
        controls: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 },
        status: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: '18px', marginTop: 8, wordBreak: 'break-word' },
        modalFields: { display: 'flex', flexDirection: 'column', gap: 14, width: '100%', minWidth: 0 },
        modalField: { display: 'flex', flexDirection: 'column', gap: 6, width: '100%', minWidth: 0 },
        modalInput: { width: '100%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box' },
        modalLabel: { color: 'var(--dsw-alias-label-primary)', fontSize: 13, lineHeight: '20px' },
        modalError: { color: 'var(--dsw-alias-status-error)', fontSize: 12, lineHeight: '18px' },
        importFileHeading: { color: 'var(--dsw-alias-label-primary)', fontSize: 12, fontWeight: 500, lineHeight: '18px', marginTop: 12 },
        importFileList: { maxHeight: 160, overflowY: 'auto', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: '8px 10px', marginTop: 6 },
        importFile: { color: 'var(--dsw-alias-label-secondary)', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 11, lineHeight: '18px', overflowWrap: 'anywhere' },
        version: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: '18px', whiteSpace: 'nowrap' },
        rowActions: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, flex: '0 1 auto', maxWidth: '100%' },
        updateBlock: { display: 'flex', flexDirection: 'column', gap: 0 },
        updateHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', padding: '14px 0' },
      }
      const inlineStatus = key => messages[key]
        ? h('div', { ref: node => { statusRefs.current[key] = node }, style: styles.status, role: 'status', 'aria-live': 'polite' }, messages[key])
        : null
      if (!settings) return h('div', { style: styles.group }, h('div', { style: styles.pageTitle }, t(page === 'updates' ? 'updates' : 'title')),
        h('div', { style: styles.hint, role: 'status' }, messages.portable || t('checking')))
      const booleanRow = (key, title, hint) => h('div', { style: styles.item },
        h('div', { style: styles.text }, h('div', { style: styles.label }, title), h('div', { style: styles.hint }, hint)),
        h(PortableSelector, {
          primitives, value: settings[key] ? 'on' : 'off', label: title,
          items: [{ id: 'off', label: t('off') }, { id: 'on', label: t('on') }],
          onSelect: value => update({ [key]: value === 'on' }),
        }))
      const updateRow = (scope, key, title, version, hint, details = null) => h('section', { style: styles.updateBlock, className: 'dshPortableCard dshPortableCardRows', 'aria-label': title },
        h('div', { style: styles.updateHeader, className: 'dshPortableRow' },
          h('div', { style: styles.text }, h('div', { style: styles.heading }, title),
            h('div', { style: styles.hint }, hint),
            version && h('div', { style: styles.version }, format(t('currentVersion'), scope === 'engine' ? coreLabel(version) : version)),
            inlineStatus(`update-${scope}`)),
          h(primitives.Button, { size: 'sm', variant: 'outline', disabled: Boolean(busy) || settingsSaving, onClick: () => checkUpdate(scope) },
            busy === `update-${scope}` ? t('checking') : (scope === 'engine' && engineVersion && engineVersion !== version) || (scope === 'product' && productVersion && productVersion !== version)
              ? format(t('installVersionNamed'), scope === 'engine' ? coreLabel(engineVersion) : productVersion) : updateOffers[scope] ? t('installUpdate') : t('checkUpdate'))),
        scope === 'product' && h('div', { style: styles.updateHeader, className: 'dshPortableRow' },
          h('div', { style: styles.label }, t('productVersionChoice')),
          h(PortableSelector, {
            primitives, value: productVersion || version, label: t('productVersionChoice'),
            items: [...(version && !productVersions.some(item => item.version === version) ? [{ id: version, label: format(t('currentTag'), version) }] : []), ...productVersions.map(item => ({ id: item.version, label: item.version === version ? format(t('currentTag'), version) : item.version }))],
            onSelect: setProductVersion,
          })),
        scope === 'product' && version && productVersion && compareCoreVersions(productVersion, version) < 0
          && h('div', { style: styles.hint, role: 'status' }, t('productDowngradeHint')),
        scope === 'product' && productCatalogLoaded && !productVersions.some(item => item.version !== version)
          && h('div', { style: styles.hint }, t('noProductVersions')),
        scope === 'engine' && version && h('div', { style: styles.updateHeader, className: 'dshPortableRow' },
          h('div', { style: styles.label }, t('versionChoice')),
          h(PortableSelector, {
            primitives, value: engineVersion || version, label: t('versionChoice'),
            items: [version, ...engineVersions.map(item => item.version).filter(item => item !== version)]
              .sort((left, right) => compareCoreVersions(right, left))
              .map(item => ({ id: item, label: item === version ? format(t('currentTag'), coreLabel(item)) : coreLabel(item) })),
            onSelect: setEngineVersion,
          })),
        scope === 'engine' && version && engineVersion && compareCoreVersions(engineVersion, version) < 0
          && h('div', { style: styles.hint, role: 'status' }, t('engineDowngradeHint')),
        h('div', { style: styles.updateHeader, className: 'dshPortableRow' },
          nativeHostTransport()?.capabilities.openUpdateFromFile === true && h(primitives.Button, { size: 'sm', variant: 'outline', disabled: Boolean(busy) || settingsSaving,
            onClick: () => updateFromFile(scope) }, t('updateFromFile')),
          nativeHostTransport()?.capabilities.prepareOfflineUpdateFiles === true
            ? h(primitives.Button, { size: 'sm', variant: 'outline', disabled: Boolean(busy) || settingsSaving,
              onClick: () => downloadUpdateFiles(scope) }, t('getUpdateFiles'))
            : h('a', { href: 'https://github.com/WSL043/DSH-Portable/blob/main/docs/offline-updates.md',
              target: '_blank', rel: 'noopener noreferrer', style: { ...styles.hint, color: 'inherit', textUnderlineOffset: '3px' } }, t('getUpdateFiles'))),
        nativeHostTransport()?.capabilities.prepareOfflineUpdateFiles === true
          && h('div', { style: styles.hint }, t('getUpdateFilesHint')),
        h('div', { style: styles.updateHeader, className: 'dshPortableRow' },
          h('div', { style: styles.label }, t(scope === 'engine' ? 'startupCheckEngine' : 'startupCheckProduct')),
          h(PortableSelector, {
            primitives, value: settings[key] ? 'on' : 'off', label: `${title} · ${t('startupCheck')}`,
            items: [{ id: 'off', label: t('off') }, { id: 'on', label: t('on') }],
            onSelect: value => update({ [key]: value === 'on' }),
          })),
        details)
      const restoreKey = coreRestore && versions.engine && compareCoreVersions(coreRestore.preferredCore, versions.engine) > 0
        ? ({ 'awaiting-qualification': 'coreRestoreWaiting', 'catalog-unavailable': 'coreRestoreRetry', failed: 'coreRestoreRetry' })[coreRestore.status] : null
      const updatesSection = h('section', { style: { ...styles.section, marginTop: 16, gap: 12 }, 'aria-label': t('updates') },
        restoreKey && h('div', { style: styles.status, role: 'status' },
          format(t(restoreKey), coreLabel(coreRestore.preferredCore), coreLabel(versions.engine))),
        // The notice is about the program that is running now; once a later update succeeded, or after two weeks, it is stale.
        lastUpdate?.status === 'rolled-back' && (!lastUpdate.restoredVersion || lastUpdate.restoredVersion === versions.portable)
          && !(Date.now() - Date.parse(lastUpdate.recordedAt) > 14 * 86400000) && h('div', { style: styles.status, role: 'status' },
          format(t('updateRolledBack'), lastUpdate.restoredVersion || t('previousVersion'))),
        updateRow('product', 'productUpdateCheckEnabled', t('product'), versions.portable, t('productHint')),
        updateRow('engine', 'engineUpdateCheckEnabled', t('engine'), versions.engine, t('engineHint'),
          engineUnavailable.length > 0 && h('details', {
            style: { ...styles.hint, marginTop: 8 },
          },
          h('summary', { style: { cursor: 'pointer' } },
            format(t('engineUnavailableSummary'), engineUnavailable.length)),
          h('div', { style: { display: 'grid', gap: 4, marginTop: 8 } },
            engineUnavailable.map((item, index) => h('div', {
              key: `${item.version}-${index}`, style: styles.status, role: 'status',
            }, unavailableMessage(item)))))))
      if (page === 'updates') return h('div', { style: styles.group },
        h('div', { style: styles.pageTitle }, t('updates')),
        inlineStatus('portable'), updatesSection,
        h('div', { style: { ...styles.hint, marginTop: 16 } }, t('updateRecovery')))
      const environmentItems = environments.items.map(item => ({
        id: item.id,
        label: item.id === 'default' ? t('defaultEnvironment') : item.name || item.id,
      }))
      const environmentSection = environmentsSupported && h('section', { style: styles.section, 'aria-label': t('environments') },
        h('div', { style: styles.sectionHeading }, t('environments')),
        h('div', { className: 'dshPortableCard' }, h('div', { style: styles.item },
          h('div', { style: styles.text },
            h('div', { style: styles.label }, t('environmentTitle')),
            h('div', { style: styles.hint }, t('environmentHint')),
            inlineStatus('environment')),
          h('div', { style: styles.rowActions },
            h(PortableSelector, {
              primitives, value: environments.current, label: t('environmentTitle'), items: environmentItems,
              onSelect: openEnvironment,
            }),
            h(primitives.Button, { size: 'sm', variant: 'outline', disabled: Boolean(busy), onClick: () => setEnvironmentDialog(true) }, t('newEnvironment'))))))
      const desktopSection = h('section', { style: styles.section, 'aria-label': t('desktop') },
        h('div', { style: styles.sectionHeading }, t('desktop')),
        h('div', { className: 'dshPortableCard' }, booleanRow('taskNotificationsEnabled', t('notifications'), notificationAvailability === 'disabled-system' ? t('notificationsSystemDisabled') : t('notificationsHint')),
        h('div', { style: styles.item },
          h('div', { style: styles.text }, h('div', { style: styles.label }, t('close'))),
          h(PortableSelector, {
            primitives, value: settings.closeBehavior, label: t('close'),
            items: [{ id: 'tray', label: t('tray') }, { id: 'exit', label: t('exit') }],
            onSelect: closeBehavior => update({ closeBehavior }),
          }))))
      const maintenanceMenu = h(primitives.Menu, {
        open: maintenanceMenuOpen,
        anchor: h(primitives.Button, { size: 'sm', variant: 'outline', disabled: Boolean(busy), onClick: () => setMaintenanceMenuOpen(current => !current) }, t('more')),
        align: 'end', portal: true,
        items: [{ id: 'repair', label: t('repair') }, { id: 'report', label: t('report') }, { id: 'storage', label: t('storageUsage') }, { id: 'storage-clean', label: t('storageClean') }, { id: 'dependency-clean', label: t('dependencyClean') },
          ...(nativeHostTransport()?.capabilities.clearWebCache === true ? [{ id: 'web-cache', label: t('clearWebCache') }] : [])],
        onClose: () => setMaintenanceMenuOpen(false),
        onSelect: id => {
          setMaintenanceMenuOpen(false)
          if (id === 'repair') action('repair', '/dsh-portable/repair')
          else if (id === 'report') exportSupportReport()
          else if (id === 'storage') {
            setBusy('storage')
            fetch('/dsh-portable/storage', { cache: 'no-store' }).then(async response => {
              const body = await response.json()
              if (!response.ok || !Array.isArray(body.categories)) throw new Error(body.error || t('invalidResult'))
              const sizes = body.categories.map(item => `${(item.bytes / 1048576).toFixed(1)} MiB${item.complete ? '' : '+'}`)
              setStatus('maintenance', `${t('storageNames')}: ${sizes.join(' / ')}. ${body.complete ? '' : t('storagePartial')} ${t('storageProtected')}`)
            }).catch(error => setStatus('maintenance', format(t('failed'), error.message))).finally(() => setBusy(''))
          }
          else if (id === 'storage-clean') {
            setBusy('storage-clean')
            fetch('/dsh-portable/storage-clean', { method: 'POST' }).then(async response => {
              const body = await response.json()
              if (!response.ok || !Number.isInteger(body.runtimes) || !Number.isInteger(body.logs)) throw new Error(body.error || t('invalidResult'))
              const labels = { runtime: 'storageCleanRuntime', webview: 'storageCleanWebView', logs: 'storageCleanLogs' }
              const failures = Array.isArray(body.failures) ? body.failures : []
              const details = [...new Set(failures.flatMap(item => Object.hasOwn(labels, item?.component)
                ? [t(labels[item.component]) + (/^[A-Z][A-Z_0-9]{0,63}$/.test(item.code || '') ? ` (${item.code})` : '')]
                : []))].join(', ')
              const warning = failures.length ? `${t('storageCleanFailed')} ${details}` : body.complete ? '' : t('storageCleanPartial')
              setStatus('maintenance', `${t('storageCleanResult').replace('{0}', body.runtimes).replace('{1}', body.logs).replace('{2}', body.webviews ?? 0)} ${warning} ${t('storageCleanProtected')}`)
            }).catch(error => setStatus('maintenance', format(t('failed'), error.message))).finally(() => setBusy(''))
          }
          else if (id === 'dependency-clean') {
            setBusy('dependency-clean')
            setStatus('maintenance', t('dependencyCleaning'))
            fetch('/dsh-portable/plugin-cache-clean', { method: 'POST' }).then(async response => {
              const body = await response.json()
              if (!response.ok || body.complete !== true) {
                const message = body.code === 'STORE_EXTERNAL_REFERENCE' ? 'dependencyCleanExternal' : 'dependencyCleanBlocked'
                setStatus('maintenance', `${t(message)} ${/^STORE_[A-Z_]+$/.test(body.code || '') ? body.code : ''}`)
                return
              }
              setStatus('maintenance', t('dependencyCleanResult').replace('{0}', body.environments).replace('{1}', body.references))
            }).catch(() => setStatus('maintenance', t('dependencyCleanBlocked'))).finally(() => setBusy(''))
          }
          else if (id === 'web-cache') {
            setBusy('web-cache')
            setStatus('maintenance', '')
            clearWebCache().then(() => setStatus('maintenance', t('webCacheCleared')))
              .catch(error => { if (error.code !== 'REQUEST_CANCELLED') setStatus('maintenance', format(t('failed'), error.message)) })
              .finally(() => setBusy(''))
          }
        },
      })
      const careSection = h('section', { style: styles.section, 'aria-label': t('care') },
        h('div', { style: styles.sectionHeading }, t('care')),
        h('div', { className: 'dshPortableCard' }, h('div', { style: styles.item },
          h('div', { style: styles.text },
            h('div', { style: styles.label }, t('maintenance')),
            h('div', { style: styles.hint }, t('maintenanceHint')),
            inlineStatus('maintenance')),
          h('div', { style: styles.rowActions },
            h(primitives.Button, { size: 'sm', variant: 'outline', disabled: Boolean(busy), onClick: () => action('doctor', '/dsh-portable/doctor') }, busy === 'doctor' ? t('checking') : t('check')),
            maintenanceMenu))))
      const privatePasswordMismatch = privatePasswordConfirm.length > 0 && privatePassword !== privatePasswordConfirm
      const environmentCreateDialog = environmentDialog ? h(primitives.Modal, {
        open: true,
        onClose: () => { if (!busy) { setEnvironmentDialog(false); setEnvironmentName('') } },
        title: t('newEnvironment'),
        description: t('environmentHint'),
        footer: h(React.Fragment, null,
          h(primitives.Button, { variant: 'ghost', disabled: Boolean(busy), onClick: () => { setEnvironmentDialog(false); setEnvironmentName('') } }, t('cancel')),
          h(primitives.Button, { variant: 'primary', disabled: Boolean(busy) || !environmentName.trim(), onClick: createEnvironment }, busy === 'environment-create' ? t('checking') : t('createEnvironment'))),
      }, h('label', { style: styles.modalField },
        h('span', { style: styles.modalLabel }, t('environmentName')),
        h(primitives.Input, { style: styles.modalInput, maxLength: 40, value: environmentName, onChange: event => setEnvironmentName(event.target.value), autoFocus: true }))) : null
      const privateDialog = dataDialog === 'private' ? h(primitives.Modal, {
        open: true,
        onClose: () => { if (!busy) closePrivateDialog() },
        title: t('dataPrivate'),
        description: `${t('dataScope')}：${t(dataScope === 'data-only' ? 'dataOnly' : 'dataFull')}`,
        footer: h(React.Fragment, null,
          h(primitives.Button, { variant: 'ghost', disabled: Boolean(busy), onClick: closePrivateDialog }, t('cancel')),
          h(primitives.Button, {
            variant: 'primary',
            disabled: Boolean(busy) || privatePassword.length < 8 || privatePassword !== privatePasswordConfirm,
            onClick: () => exportData('private'),
          }, busy === 'data-private' ? t('checking') : t('exportNow'))),
      }, h('div', { style: styles.modalFields },
        h('label', { style: styles.modalField },
          h('span', { style: styles.modalLabel }, t('dataPassword')),
          h(primitives.Input, { style: styles.modalInput, type: 'password', autoComplete: 'new-password', value: privatePassword, onChange: event => setPrivatePassword(event.target.value), autoFocus: true })),
        h('label', { style: styles.modalField },
          h('span', { style: styles.modalLabel }, t('dataPasswordConfirm')),
          h(primitives.Input, { style: styles.modalInput, type: 'password', autoComplete: 'new-password', value: privatePasswordConfirm, onChange: event => setPrivatePasswordConfirm(event.target.value) })),
        privatePasswordMismatch && h('div', { style: styles.modalError, role: 'alert' }, t('dataPasswordMismatch')),
        h('div', { style: styles.hint }, t('chooseSaveLocation')),
        inlineStatus('data'))) : null
      const importPasswordDialog = dataDialog === 'import-password' ? h(primitives.Modal, {
        open: true, onClose: () => { if (!busy) closeImportDialog() }, title: t('dataImportPassword'), description: t('dataImportPasswordHint'),
        footer: h(React.Fragment, null,
          h(primitives.Button, { variant: 'ghost', disabled: Boolean(busy), onClick: closeImportDialog }, t('cancel')),
          h(primitives.Button, { variant: 'primary', disabled: Boolean(busy) || importPassword.length < 8, onClick: unlockImport }, busy ? t('checking') : t('dataImportReview'))),
      }, h('label', { style: styles.modalField },
        h('span', { style: styles.modalLabel }, t('dataPassword')),
        h(primitives.Input, { style: styles.modalInput, type: 'password', autoComplete: 'current-password', value: importPassword, onChange: event => setImportPassword(event.target.value), autoFocus: true }))) : null
      const importInfo = importState?.info
      const importPreviewFiles = Array.isArray(importInfo?.files) ? importInfo.files.map(String).slice(0, 80) : []
      const hiddenImportFileCount = Array.isArray(importInfo?.files) ? Math.max(0, importInfo.files.length - importPreviewFiles.length) : 0
      const importConfirmDialog = dataDialog === 'import-confirm' && importInfo ? h(primitives.Modal, {
        open: true, onClose: () => { if (!busy) closeImportDialog() }, title: t('dataImportReview'),
        description: format(t('dataImportReviewHint'), Array.isArray(importInfo.files) ? importInfo.files.length : 0),
        footer: h(React.Fragment, null,
          h(primitives.Button, { variant: 'ghost', disabled: Boolean(busy), onClick: closeImportDialog }, t('cancel')),
          h(primitives.Button, { variant: 'primary', disabled: Boolean(busy), onClick: runImport }, busy === 'data-import-run' ? t('dataImporting') : t('dataImportRestart'))),
      }, h('div', null,
        h('div', { style: styles.hint }, format(t('dataImportCategories'), (importInfo.categories || []).join(', '))),
        h('div', { style: styles.importFileHeading }, t('dataImportFiles')),
        h('div', { style: styles.importFileList },
          importPreviewFiles.map(file => h('div', { key: file, style: styles.importFile }, file)),
          hiddenImportFileCount > 0 && h('div', { style: styles.importFile }, format(t('dataImportMoreFiles'), hiddenImportFileCount))))) : null
      const dataSection = h('section', { style: styles.section, 'aria-label': t('data') },
        h('div', { style: styles.sectionHeading }, t('data')),
        h('div', { className: 'dshPortableCard' }, h('div', { style: styles.item },
          h('div', { style: styles.text }, h('div', { style: styles.label }, t('dataTitle')), h('div', { style: styles.hint }, t('dataHint')), inlineStatus('data')),
          h('div', { style: styles.rowActions },
            h(primitives.Button, { size: 'sm', variant: 'outline', title: t('dataImportHint'), disabled: Boolean(busy), onClick: beginImport }, t('dataImport')),
            h(primitives.Button, { size: 'sm', variant: 'outline', disabled: Boolean(busy), onClick: () => { setStatus('data', ''); setDataDialog('export') } }, t('dataExport'))))))
      const exportDialog = dataDialog === 'export' ? h(primitives.Modal, {
        open: true, title: t('dataExport'), description: t('dataHint'),
        onClose: () => { if (!busy) setDataDialog('') },
        footer: h(React.Fragment, null,
          h(primitives.Button, { variant: 'ghost', disabled: Boolean(busy), onClick: () => setDataDialog('') }, t('cancel')),
          h(primitives.Button, { variant: 'primary', disabled: Boolean(busy), onClick: () => exportKind === 'private' ? setDataDialog('private') : exportData('standard') }, busy ? t('checking') : t('continue'))),
      }, h('div', { style: styles.modalFields },
        h('div', { style: styles.modalLabel }, t('dataScope')),
        h(PortableSelector, { primitives, label: t('dataScope'), value: dataScope, disabled: Boolean(busy), items: [{ id: 'full', label: t('dataFull') }, { id: 'data-only', label: t('dataOnly') }], onSelect: setDataScope }),
        h('div', { style: styles.modalLabel }, t('exportFormat')),
        h(PortableSelector, { primitives, label: t('exportFormat'), value: exportKind, disabled: Boolean(busy), items: [{ id: 'standard', label: t('exportPlain') }, { id: 'private', label: t('exportEncrypted') }], onSelect: setExportKind }),
        h('div', { style: styles.hint }, t(exportKind === 'private' ? 'dataPrivateHint' : 'dataStandardHint')),
        exportKind !== 'private' && dataScope === 'full' && h('div', { style: styles.status, role: 'alert' }, t('dataPlainCredentialsWarning')),
        inlineStatus('data'))) : null
      return h('div', { style: styles.group },
        h('div', { style: styles.pageTitle }, t('title')),
        inlineStatus('portable'),
        desktopSection,
        dataSection,
        environmentSection,
        careSection,
        h('section', { style: styles.section, 'aria-label': t('community') },
          h('div', { style: styles.sectionHeading }, t('community')),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px 20px', marginTop: 4, fontSize: 13, lineHeight: '20px' } },
            ...[
              ['repository', 'https://github.com/WSL043/DSH-Portable'],
              ['reportProblem', 'https://github.com/WSL043/DSH-Portable/issues/new/choose'],
              ['suggestIdea', 'https://github.com/WSL043/DSH-Portable/discussions/new'],
              ['starProject', 'https://github.com/WSL043/DSH-Portable'],
            ].map(([key, href]) => h('a', { key, href, target: '_blank', rel: 'noopener noreferrer', style: { color: 'inherit', textUnderlineOffset: '3px' } }, t(key)))),
          h('div', { style: { ...styles.hint, marginTop: 8 } }, t('communityHint'))),
        environmentCreateDialog,
        exportDialog,
        privateDialog,
        importPasswordDialog,
        importConfirmDialog)
    }

    function localeOf(ctx) {
      const active = String(ctx.locale.getLocale()?.active ?? '').toLowerCase().split('-')[0]
      return Object.prototype.hasOwnProperty.call(copy, active) ? active : 'en'
    }

    function useLocale(ctx) {
      return React.useSyncExternalStore(
        listener => ctx.on('locale/change', listener),
        () => localeOf(ctx),
      )
    }

    function themeOf(ctx) {
      return ctx.theme.getTheme()?.active?.colorScheme === 'dark' ? 'dark' : 'light'
    }

    function finalAssistantReply(ctx, sessionId) {
      const entries = ctx.sessions.binding?.(sessionId)?.eventSource?.getSnapshot?.()?.entries
      if (!Array.isArray(entries)) return ''
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]
        const event = entry?.type === 'event' ? entry.event : entry
        if (event?.type !== 'assistant/message') continue
        const content = event.data?.message?.content
        if (!Array.isArray(content)) continue
        const text = content
          .filter(block => block?.type === 'text' && typeof block.text === 'string')
          .map(block => block.text)
          .join('')
          .trim()
        if (text !== '') return text.slice(0, 32768)
      }
      return ''
    }

    function notificationInteraction(interaction) {
      if (!interaction || typeof interaction !== 'object') return { prompt: '', options: [] }
      if (interaction.kind === 'approval') {
        const fallback = interaction.toolName == null ? '' : `Tool ${String(interaction.toolName)} requests approval`
        const prompt = String(interaction.reason || fallback).trim().slice(0, 512)
        return { prompt, options: ['rejected', 'allowed-once'] }
      }
      if (interaction.kind !== 'question' && interaction.kind !== 'plan-review') return { prompt: '', options: [] }
      const questions = Array.isArray(interaction.questions) ? interaction.questions : []
      if (questions.length !== 1 || questions[0]?.multiSelect === true) return { prompt: '', options: [] }
      const options = Array.isArray(questions[0]?.options)
        ? questions[0].options.map(option => String(option?.label || '').trim()).filter(Boolean)
        : []
      if (options.length === 0 || options.length > 4 || new Set(options).size !== options.length
        || options.some(option => option.length > 80 || option.includes('\0'))) return { prompt: '', options: [] }
      return { prompt: String(questions[0]?.question || '').trim().slice(0, 512), options }
    }

    function recentSessions(source) {
      // Keep the same stable newest-first order without sorting the whole history.
      const recent = []
      for (const id of source.ids ?? []) {
        const item = source.byId?.[id]
        if (!item || item.blank || item.origin === 'subagent') continue
        const updatedAt = Number(item.updatedAt || 0)
        if (recent.length === 10 && updatedAt <= Number(recent[9].updatedAt || 0)) continue
        let index = 0
        while (index < recent.length && updatedAt <= Number(recent[index].updatedAt || 0)) index++
        recent.splice(index, 0, item)
        if (recent.length > 10) recent.pop()
      }
      return recent
    }

    function sessionState(ctx, source, recent) {
      const current = currentSessionIdFromSnapshot(source)
      const hasRunningSession = (source.ids ?? []).some(id => Boolean(source.byId?.[id]?.running))
      const sessions = recent
        .map(item => {
          const completed = Boolean(item.completed)
          const interaction = item.pendingInteraction
          const pendingInteraction = typeof interaction === 'string'
            ? interaction
            : interaction?.kind == null ? '' : String(interaction.kind)
          const pendingInteractionKey = typeof interaction === 'object' && interaction?.key != null
            ? String(interaction.key)
            : pendingInteraction
          const notification = notificationInteraction(interaction)
          return {
            id: String(item.id),
            title: String(item.displayTitle || item.title || item.id),
            updatedAt: Number(item.updatedAt || 0),
            running: Boolean(item.running),
            completed,
            finalReply: completed ? finalAssistantReply(ctx, item.id) : '',
            pendingInteraction,
            pendingInteractionKey,
            pendingInteractionPrompt: notification.prompt,
            pendingInteractionOptions: notification.options,
            agentPreset: item.agentPreset == null ? '' : String(item.agentPreset),
          }
        })
      return {
        type: 'dsh-portable/state',
        schemaVersion: 1,
        locale: localeOf(ctx),
        theme: themeOf(ctx),
        themePreference: ctx.theme?.getTheme?.()?.preference || 'system',
        currentSessionId: current == null ? '' : String(current),
        hasRunningSession,
        sessions,
      }
    }

    function currentSessionIdFromSnapshot(snapshot) {
      if (Object.prototype.hasOwnProperty.call(snapshot || {}, 'current')) return snapshot.current ?? null
      return Object.values(snapshot?.byId || {}).find(item => (item?.retainedBy?.mainView ?? 0) > 0)?.id ?? null
    }

    function openSession(ctx, sessionId) {
      const uiWorkspace = ctx.uiWorkspace
      if (typeof uiWorkspace?.openSession === 'function') {
        uiWorkspace.openSession(sessionId)
        return true
      }
      if (typeof ctx.sessions?.open === 'function') {
        ctx.sessions.open(sessionId)
        return true
      }
      return false
    }

    function startSession(ctx) {
      const uiWorkspace = ctx.uiWorkspace
      if (typeof uiWorkspace?.startSession === 'function') {
        uiWorkspace.startSession()
        return true
      }
      if (typeof ctx.sessions?.clear === 'function') {
        ctx.sessions.clear()
        return true
      }
      return false
    }

    function clearCurrentSession(ctx) {
      const uiWorkspace = ctx.uiWorkspace
      if (typeof uiWorkspace?.clearMain === 'function') {
        uiWorkspace.clearMain()
        return true
      }
      if (typeof ctx.sessions?.clear === 'function') {
        ctx.sessions.clear()
        return true
      }
      return false
    }

    function applyNativeDownload(ctx, message) {
      if (message?.schemaVersion !== 1) return
      const sessionId = String(message.sessionId || '')
      if (!sessionId || !ctx.sessionLogDownload?.store?.update) return
      const nativeDownload = {
        state: String(message.state || ''),
        fileName: String(message.fileName || ''),
        bytesReceived: Math.max(0, Number(message.bytesReceived || 0)),
        totalBytes: Math.max(0, Number(message.totalBytes || 0)),
        percent: Number.isFinite(Number(message.percent)) ? Number(message.percent) : -1,
        reason: String(message.reason || ''),
      }
      const status = nativeDownload.state === 'completed'
        ? 'success'
        : nativeDownload.state === 'interrupted' || nativeDownload.state === 'cancelled'
          ? 'error'
          : 'downloading'
      ctx.sessionLogDownload.store.update(state => {
        const current = state.bySession[sessionId]
        state.bySession = {
          ...state.bySession,
          [sessionId]: {
            ...current,
            open: current?.open ?? true,
            status,
            error: status === 'error' ? nativeDownload.reason : null,
            nativeDownload,
          },
        }
      })
    }

    async function ensurePortableWorkspace(ctx, workspacePath) {
      const target = String(workspacePath || '').trim()
      if (!target || !ctx.workspaces?.list?.getSnapshot || typeof ctx.workspaces.create !== 'function') return { status: 'unavailable' }
      const baselineReady = value => value?.baselinesReady === true || value?.phase === 'ready'
      let snapshot = ctx.workspaces.list.getSnapshot()
      if (!baselineReady(snapshot)) {
        snapshot = await new Promise(resolve => {
          const stop = ctx.workspaces.list.subscribe(() => {
            const next = ctx.workspaces.list.getSnapshot()
            if (!baselineReady(next)) return
            stop?.()
            resolve(next)
          })
        })
      }
      if ((snapshot.items || []).length > 0) return { status: 'preserved' }
      if (currentSessionIdFromSnapshot(ctx.sessions?.list?.getSnapshot?.()) != null) return { status: 'preserved' }
      const workspace = await ctx.workspaces.create({ path: target })
      const startSession = ctx.uiWorkspace?.startSession?.bind(ctx.uiWorkspace)
        || ctx.workspaces.startSession?.bind(ctx.workspaces)
      if (workspace?.workspaceId && startSession) {
        startSession(workspace.workspaceId)
      }
      return { status: 'created', workspaceId: workspace?.workspaceId }
    }

    function apply(ctx) {
      const host = nativeHostTransport()
      if (React?.createElement && React?.useState && React?.useEffect) {
        try {
          const hostPrimitives = require('@deepseek-ai/dsh-client-ui-primitives')
          const primitives = {
            ...hostPrimitives,
            IconChevronDownOutline14: hostPrimitives.IconChevronDownOutlineRegular ?? hostPrimitives.IconChevronDownOutline14,
            IconDownloadOutline16: hostPrimitives.IconDownloadOutlineRegular ?? hostPrimitives.IconDownloadOutline16,
            IconFolderOpenOutline16: hostPrimitives.IconFolderOpenOutlineRegular ?? hostPrimitives.IconFolderOpenOutline16,
          }
          if (primitives?.Button && primitives?.Input && primitives?.Menu && primitives?.Modal && primitives?.Tooltip
            && primitives?.IconChevronDownOutline14 && primitives?.IconDownloadOutline16 && primitives?.IconFolderOpenOutline16) {
            if (!document.getElementById('dsh-portable-settings-controls')) {
              const style = document.createElement('style')
              style.id = 'dsh-portable-settings-controls'
              style.textContent = '.dshPortableSelector{background:var(--dsw-alias-bg-module-platform);height:36px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;border-radius:var(--dsw-radius-md);align-items:center;gap:12px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex;white-space:nowrap}.dshPortableSelector:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshPortableSelectorChevron{flex:none}.dshPortableCard{border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-xl);padding:0 14px;display:flex;flex-direction:column}.dshPortableCard>:last-child{border-bottom:0!important}.dshPortableRow~.dshPortableRow{border-top:.5px solid var(--dsw-alias-border-l2)}.dshPortableFooterUpdate{flex:none;align-items:center;align-self:flex-end;width:36px;height:36px;margin:0 0 -36px auto;display:flex;position:relative;z-index:1}.dshPortableFooterUpdateButton{width:36px;height:36px;color:var(--dsw-alias-label-primary);cursor:pointer;background:transparent;border:0;border-radius:50%;justify-content:center;align-items:center;padding:0;font:inherit;display:inline-flex;position:relative}.dshPortableFooterUpdateButton:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshPortableUpdateDot{position:absolute;right:4px;top:4px;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-business-primary)}.dshPortableEnvironmentChip{height:28px;max-width:180px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover-solid);border-radius:14px;align-items:center;gap:6px;padding:0 10px;font-size:13px;line-height:20px;display:inline-flex}.dshPortableEnvironmentChip span{white-space:nowrap;text-overflow:ellipsis;overflow:hidden}'
              document.head.appendChild(style)
            }
            const SettingsSection = () => PortableSettings(ctx, primitives)
            ctx.slots.inject('settings.section', () => ctx.slots.register({
              name: 'settings.section', id: 'portable', order: 60, label: () => copy[localeOf(ctx)].title,
            }, SettingsSection))
            const UpdatesSection = () => PortableSettings(ctx, primitives, 'updates')
            ctx.slots.inject('settings.section', () => ctx.slots.register({
              name: 'settings.section', id: 'portable-updates', order: 1, label: () => copy[localeOf(ctx)].updates,
            }, UpdatesSection))
            const UpdateAction = props => PortableUpdateAction({ ...props, primitives, ctx })
            ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
              name: 'sidebar.footer.action', id: 'portable-update', order: 80, label: () => copy[localeOf(ctx)].updateReady,
            }, UpdateAction))
            const EnvironmentChip = () => PortableEnvironmentChip({ primitives, ctx })
            ctx.slots.inject('conversation.hero.portableContext', () => ctx.slots.register({
              name: 'conversation.hero.portableContext', id: 'portable-environment', order: 80,
            }, EnvironmentChip))
            ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
              name: 'conversation.session.header.utilities', id: 'portable-environment', order: 80,
            }, EnvironmentChip))
          }
        } catch (error) { console.warn('[dsh-portable] settings section unavailable:', error) }
      }
      if (!host) return
      const webview = host.bridge
      const resolvingInteractions = new Set()
      const acknowledgeNotification = (activationId, terminal) => {
        const id = typeof activationId === 'string' ? activationId : ''
        if (!/^[0-9a-f]{32}$/i.test(id)) return
        webview.postMessage({ type: 'dsh-portable/notification-action-result', activationId: id, terminal: terminal === true })
      }

      window.__DSH_PORTABLE_HOST__ = { restart: restartPortableHost }
      window.__DSH_PORTABLE_HOST__.capabilities = host.capabilities

      ctx.effect(() => {
        let active = true
        const sessionEventStops = new Map()
        let publishTimer = null
        let lastProjection = ''
        let sidebarFrame = null
        let sidebarCollapsed = null
        const page = window.document
        const navigation = []
        let navigationIndex = -1
        let observedSession
        const recordNavigation = () => {
          const snapshot = ctx.sessions.list.getSnapshot()
          if (snapshot.phase !== 'ready') return
          const current = currentSessionIdFromSnapshot(snapshot)
          if (current === observedSession) return
          observedSession = current
          if (navigationIndex >= 0 && navigation[navigationIndex] === current) return
          navigation.splice(navigationIndex + 1)
          navigation.push(current)
          if (navigation.length > 100) navigation.shift()
          navigationIndex = navigation.length - 1
        }
        const navigationTarget = direction => {
          const snapshot = ctx.sessions.list.getSnapshot()
          for (let index = navigationIndex + direction; index >= 0 && index < navigation.length; index += direction) {
            const id = navigation[index]
            if (id === null || snapshot.byId?.[id] && snapshot.byId[id].origin !== 'subagent') return index
          }
          return -1
        }
        let workspaceRequestSequence = 0
        const pendingWorkspaceRequests = new Map()
        const directoryPickers = [...new Set([ctx.uiWorkspace, ctx.workspaces])]
          .filter(owner => typeof owner?.pickDirectory === 'function')
          .map(owner => ({ owner, original: owner.pickDirectory }))
        let nativePickDirectory = null
        let workspacePickerPromise = null
        const cancelWorkspacePicker = () => {
          for (const pending of pendingWorkspaceRequests.values()) pending.resolve(null)
          pendingWorkspaceRequests.clear()
          workspacePickerPromise = null
        }
        const cancelNativeRequests = () => {
          cancelWorkspacePicker()
          for (const pending of pendingDataExportRequests.values()) pending.resolve(null)
          pendingDataExportRequests.clear()
          for (const pending of pendingDataImportRequests.values()) pending.resolve(null)
          pendingDataImportRequests.clear()
          for (const pending of pendingHostRestartRequests.values()) {
            const error = new Error('Portable page closed before the restart reply was received.')
            error.code = 'DSH_PORTABLE_RESTART_UNCONFIRMED'
            pending.reject(error)
          }
          pendingHostRestartRequests.clear()
          for (const pending of pendingEnvironmentRequests.values()) pending.reject(new Error('Portable page closed.'))
          pendingEnvironmentRequests.clear()
        }
        // A page can enter the back/forward cache without disposing its plugins.
        // Replies to its old dialogs must not settle requests after it returns.
        window.addEventListener?.('pagehide', cancelNativeRequests)
        if (host.capabilities.pickDirectory === true && directoryPickers.length > 0) {
          nativePickDirectory = () => {
            if (!active) return Promise.resolve(null)
            if (workspacePickerPromise) return workspacePickerPromise
            const request = new Promise((resolve, reject) => {
              const requestId = `workspace-${Date.now().toString(36)}-${++workspaceRequestSequence}`
              pendingWorkspaceRequests.set(requestId, { resolve, reject })
              try { webview.postMessage({
                type: 'dsh-portable/pick-directory',
                schemaVersion: 1,
                requestId,
              }) } catch (error) {
                pendingWorkspaceRequests.delete(requestId)
                reject(error)
              }
            })
            workspacePickerPromise = request
            const clear = () => { if (workspacePickerPromise === request) workspacePickerPromise = null }
            request.then(clear, clear)
            return request
          }
          for (const { owner } of directoryPickers) owner.pickDirectory = nativePickDirectory
        }
        const syncSessionEventSubscriptions = recent => {
          const desired = new Set(recent.map(item => String(item.id)))
          for (const [id, stop] of sessionEventStops) {
            if (desired.has(id)) continue
            stop?.()
            sessionEventStops.delete(id)
          }
          for (const id of desired) {
            if (sessionEventStops.has(id)) continue
            const eventSource = ctx.sessions.binding?.(id)?.eventSource
            if (typeof eventSource?.subscribe !== 'function') continue
            sessionEventStops.set(id, eventSource.subscribe(schedulePublish))
          }
        }
        const publish = () => {
          if (!active) return
          const snapshot = ctx.sessions.list.getSnapshot()
          const recent = recentSessions(snapshot)
          syncSessionEventSubscriptions(recent)
          if (host.capabilities.sessionProjection !== true) return
          const state = sessionState(ctx, snapshot, recent)
          recordNavigation()
          state.canGoBack = navigationTarget(-1) >= 0
          state.canGoForward = navigationTarget(1) >= 0
          state.sidebarCollapsed = sidebarCollapsed
          const projection = JSON.stringify(state)
          if (projection === lastProjection) return
          lastProjection = projection
          webview.postMessage(state)
        }
        // Stream events can arrive much faster than the native menu can paint.
        // Keep one trailing snapshot, including completion and interaction state.
        const schedulePublish = () => {
          if (!active || publishTimer !== null) return
          publishTimer = setTimeout(() => {
            publishTimer = null
            publish()
          }, 100)
        }
        // AppFrame owns resolved geometry, including narrow-window auto-collapse.
        // Its public layout action service does not expose this resolved state.
        const readSidebar = () => {
          if (!sidebarFrame?.isConnected) {
            const frames = [...page.querySelectorAll('[data-shell-bottom]')]
              .map(element => element.parentElement)
              .filter(element => element?.querySelector(':scope > [data-shell-overlay]'))
            sidebarFrame = frames.length === 1 ? frames[0] : null
          }
          const next = sidebarFrame ? sidebarFrame.getAttribute('data-sidebar-collapsed') === 'true' : null
          if (next === sidebarCollapsed) return
          sidebarCollapsed = next
          schedulePublish()
        }
        let sidebarObserver = null
        if (typeof window.MutationObserver === 'function' && typeof page?.querySelectorAll === 'function' && page.body) {
          sidebarObserver = new window.MutationObserver(readSidebar)
          sidebarObserver.observe(page.body, { childList: true, subtree: true,
            attributes: true, attributeFilter: ['data-sidebar-collapsed'] })
          readSidebar()
        }
        const receive = event => {
          const message = event?.data
          if (!message) return
          if (message.type === 'dsh-portable/pick-directory-result' && message.schemaVersion === 1) {
            const requestId = String(message.requestId || '')
            const pending = pendingWorkspaceRequests.get(requestId)
            if (!pending) return
            pendingWorkspaceRequests.delete(requestId)
            if (message.error) pending.reject(new Error(String(message.error)))
            else pending.resolve(message.cancelled ? null : String(message.path || '') || null)
            return
          }
          if (message.type === 'dsh-portable/pick-data-export-result' && message.schemaVersion === 1) {
            const requestId = String(message.requestId || '')
            const pending = pendingDataExportRequests.get(requestId)
            if (!pending) return
            pendingDataExportRequests.delete(requestId)
            if (message.error) pending.reject(new Error(String(message.error)))
            else pending.resolve(message.cancelled ? null : String(message.path || '') || null)
            return
          }
          if (message.type === 'dsh-portable/pick-data-import-result' && message.schemaVersion === 1) {
            const requestId = String(message.requestId || '')
            const pending = pendingDataImportRequests.get(requestId)
            if (!pending) return
            pendingDataImportRequests.delete(requestId)
            if (message.error) pending.reject(new Error(String(message.error)))
            else pending.resolve(message.cancelled ? null : String(message.path || '') || null)
            return
          }
          if (message.type === 'dsh-portable/restart-host-result' && message.schemaVersion === 1) {
            const requestId = String(message.requestId || '')
            const pending = pendingHostRestartRequests.get(requestId)
            if (!pending) return
            pendingHostRestartRequests.delete(requestId)
            if (message.ok === true) pending.resolve(message)
            else {
              const error = new Error(String(message.error || 'Portable restart was refused.'))
              error.code = 'DSH_PORTABLE_RESTART_REJECTED'
              pending.reject(error)
            }
            return
          }
          if (message.type === 'dsh-portable/open-environment-result' && message.schemaVersion === 1) {
            const requestId = String(message.requestId || '')
            const pending = pendingEnvironmentRequests.get(requestId)
            if (!pending) return
            pendingEnvironmentRequests.delete(requestId)
            if (message.ok === true) pending.resolve(message)
            else pending.reject(new Error(String(message.error || 'Portable environment could not be opened.')))
            return
          }
          if (message.type === 'dsh-portable/download') {
            applyNativeDownload(ctx, message)
            return
          }
          if (message.type !== 'dsh-portable/action') return
          if (message.action === 'toggle-sidebar') { ctx.layout.toggleSidebar(); return }
          if (message.action === 'navigate-back' || message.action === 'navigate-forward') {
            recordNavigation()
            const target = navigationTarget(message.action === 'navigate-back' ? -1 : 1)
            if (target < 0) return
            const previousIndex = navigationIndex
            navigationIndex = target
            const id = navigation[target]
            let applied
            try {
              applied = id === null ? clearCurrentSession(ctx) : openSession(ctx, id)
            } catch (error) {
              navigationIndex = previousIndex
              throw error
            }
            if (!applied) {
              navigationIndex = previousIndex
              return
            }
            publish()
            return
          }
          if (message.action === 'open-settings') {
            window.dispatchEvent(new Event('dsh-portable/open-settings'))
            return
          }
          if (message.action === 'new-session') {
            startSession(ctx)
            return
          }
          if (message.action === 'reply-session') {
            const activationId = message.activationId
            const sessionId = String(message.sessionId || '')
            const reply = typeof message.reply === 'string' ? message.reply.trim() : ''
            if (reply === '' || reply.length > 8000 || reply.includes('\0')) { acknowledgeNotification(activationId, true); return }
            const snapshot = ctx.sessions.list.getSnapshot()
            if (snapshot?.phase !== 'ready' && !snapshot.byId?.[sessionId]) { acknowledgeNotification(activationId, false); return }
            if (!snapshot.byId?.[sessionId] || snapshot.byId[sessionId].origin === 'subagent') { acknowledgeNotification(activationId, true); return }
            let session
            try { session = ctx.sessions.binding?.(sessionId)?.session }
            catch { acknowledgeNotification(activationId, false); return }
            if (typeof session?.prompt !== 'function') { acknowledgeNotification(activationId, false); return }
            void Promise.resolve().then(() => session.prompt([{ type: 'text', text: reply }], 'queue'))
              .then(result => {
                if (!result?.ok) throw new Error(`Session prompt failed: ${result?.error?.code || 'unknown'}`)
              })
              .then(() => acknowledgeNotification(activationId, true))
              .catch(error => { console.warn('[dsh-portable] notification reply failed:', error); acknowledgeNotification(activationId, true) })
            return
          }
          if (message.action === 'resolve-interaction') {
            const activationId = message.activationId
            const sessionId = String(message.sessionId || '')
            const interactionKey = String(message.interactionKey || '')
            const response = typeof message.response === 'string' ? message.response.trim() : ''
            if (!sessionId || !interactionKey || interactionKey.length > 256 || !response
              || response.length > 80 || interactionKey.includes('\0') || response.includes('\0')) { acknowledgeNotification(activationId, true); return }
            const snapshot = ctx.sessions.list.getSnapshot()
            if (snapshot?.phase !== 'ready' && !snapshot.byId?.[sessionId]) { acknowledgeNotification(activationId, false); return }
            const session = snapshot.byId?.[sessionId]
            const pending = session?.pendingInteraction
            if (!session || session.origin === 'subagent' || !pending || typeof pending !== 'object'
              || String(pending.key || '') !== interactionKey || typeof pending.answer !== 'function') { acknowledgeNotification(activationId, true); return }
            const eligibility = notificationInteraction(pending)
            if (!eligibility.options.includes(response)) { acknowledgeNotification(activationId, true); return }
            const resolutionId = `${sessionId}\0${interactionKey}`
            if (resolvingInteractions.has(resolutionId)) return
            resolvingInteractions.add(resolutionId)
            if (pending.kind === 'approval') {
              void pending.answer(response)
                .then(() => acknowledgeNotification(activationId, true))
                .catch(error => { console.warn('[dsh-portable] notification approval failed:', error); acknowledgeNotification(activationId, true) })
                .finally(() => resolvingInteractions.delete(resolutionId))
              return
            }
            const questions = Array.isArray(pending.questions) ? pending.questions : []
            const matched = Array.isArray(questions[0]?.options)
              ? questions[0].options.find(option => String(option?.label || '').trim() === response)
              : undefined
            if (!matched || questions[0]?.id == null) { resolvingInteractions.delete(resolutionId); acknowledgeNotification(activationId, true); return }
            void pending.answer({ answers: [{ id: questions[0].id, selected: [String(matched.label)] }] })
              .then(() => acknowledgeNotification(activationId, true))
              .catch(error => { console.warn('[dsh-portable] notification question failed:', error); acknowledgeNotification(activationId, true) })
              .finally(() => resolvingInteractions.delete(resolutionId))
            return
          }
          if (message.action !== 'open-session') return
          const activationId = message.activationId
          const sessionId = String(message.sessionId || '')
          const snapshot = ctx.sessions.list.getSnapshot()
          if (snapshot?.phase !== 'ready' && !snapshot.byId?.[sessionId]) { acknowledgeNotification(activationId, false); return }
          if (snapshot.byId?.[sessionId] && snapshot.byId[sessionId].origin !== 'subagent') {
            if (!openSession(ctx, sessionId)) { acknowledgeNotification(activationId, false); return }
          }
          acknowledgeNotification(activationId, true)
        }

        webview.addEventListener('message', receive)
        const stopSessions = ctx.sessions.list.subscribe(() => { recordNavigation(); schedulePublish() })
        const stopLocale = ctx.on('locale/change', publish)
        const stopTheme = ctx.on('theme/change', publish)
        publish()

        if (typeof fetch === 'function') {
          fetch('/dsh-portable/settings', { cache: 'no-store' })
            .then(response => response.json())
            .then(body => active && ensurePortableWorkspace(ctx, body.workspacePath))
            .catch(error => { if (active) console.warn('[dsh-portable] default workspace unavailable:', error) })
        }

        return () => {
          active = false
          sidebarObserver?.disconnect()
          if (publishTimer !== null) clearTimeout(publishTimer)
          publishTimer = null
          for (const { owner, original } of directoryPickers) {
            if (nativePickDirectory && owner.pickDirectory === nativePickDirectory) owner.pickDirectory = original
          }
          window.removeEventListener?.('pagehide', cancelNativeRequests)
          cancelNativeRequests()
          if (window.__DSH_PORTABLE_HOST__?.restart === restartPortableHost) delete window.__DSH_PORTABLE_HOST__
          webview.removeEventListener?.('message', receive)
          stopSessions?.()
          for (const stop of sessionEventStops.values()) stop?.()
          sessionEventStops.clear()
          stopLocale?.()
          stopTheme?.()
        }
      })
    }

    exports.inject = inject
    exports.finalAssistantReply = finalAssistantReply
    exports.ensurePortableWorkspace = ensurePortableWorkspace
    exports.apply = apply
    return exports
  },
})

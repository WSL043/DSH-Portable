import AppKit
import Foundation
import WebKit

private let usesChineseUI = Locale.preferredLanguages.first?.lowercased().hasPrefix("zh") == true

private func L(_ chinese: String, _ english: String) -> String {
    usesChineseUI ? chinese : english
}

private enum HostError: LocalizedError {
    case incomplete
    case commandFailed(String)
    case invalidURL

    var errorDescription: String? {
        switch self {
        case .incomplete:
            return L("DeepSeek Harness 运行文件不完整。请重新下载并完整解压。",
                     "DeepSeek Harness files are incomplete. Download and extract the package again.")
        case .commandFailed(let details):
            return details
        case .invalidURL:
            return L("DeepSeek Harness 返回了无效的本地地址。",
                     "DeepSeek Harness returned an invalid local address.")
        }
    }
}

private struct WindowFrameState: Codable {
    let schemaVersion: Int
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

private final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var statusLabel: NSTextField!
    private var spinner: NSProgressIndicator!
    private var applicationURL: URL?
    private var allowingClose = false
    private var shuttingDown = false
    private var backendStarted = false
    private var hasRunningSession = false
    private var restartAfterShutdown = false
    private var manualUpdateRunning = false
    private var automaticUpdateMenuItem: NSMenuItem!
    private var productUpdateMenuItem: NSMenuItem!
    private var engineUpdateMenuItem: NSMenuItem!
    private var webContentRecoveryAttempts = 0
    private var webContentRecoveryPending = false
    private var webContentRecoveryFailureShown = false

    private var installedMode: Bool {
        Bundle.main.bundleIdentifier == "io.github.wsl043.dsh-portable.installed"
    }

    private var runtimeRoot: URL {
        if installedMode { return Bundle.main.resourceURL! }
        return Bundle.main.bundleURL.deletingLastPathComponent()
    }

    private var nodeURL: URL {
        runtimeRoot.appendingPathComponent("runtime/node/bin/node")
    }

    private var cliURL: URL {
        runtimeRoot.appendingPathComponent("launcher/portable-cli.mjs")
    }

    private var productDataRoot: URL {
        if installedMode {
            return FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Application Support/DeepSeek-Herness/data")
        }
        return runtimeRoot.appendingPathComponent("data")
    }

    private var windowStateURL: URL {
        productDataRoot.appendingPathComponent("window-state.json")
    }

    private var launcherSettingsURL: URL {
        productDataRoot.appendingPathComponent("launcher-settings.json")
    }

    private var launcherLogURL: URL {
        productDataRoot.appendingPathComponent("logs/launcher.log")
    }

    private func writeLauncherLog(_ category: String, _ message: String) {
        let sanitized = message.replacingOccurrences(of: "\r", with: " ")
            .replacingOccurrences(of: "\n", with: " | ")
        let line = "\(ISO8601DateFormatter().string(from: Date())) [\(category)] \(sanitized)\n"
        guard let data = line.data(using: .utf8) else { return }
        do {
            let logs = launcherLogURL.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
            if let size = try? launcherLogURL.resourceValues(forKeys: [.fileSizeKey]).fileSize,
               size > 2 * 1024 * 1024 {
                let previous = logs.appendingPathComponent("launcher.log.previous")
                try? FileManager.default.removeItem(at: previous)
                try FileManager.default.moveItem(at: launcherLogURL, to: previous)
            }
            if !FileManager.default.fileExists(atPath: launcherLogURL.path) {
                FileManager.default.createFile(atPath: launcherLogURL.path, contents: nil)
            }
            let handle = try FileHandle(forWritingTo: launcherLogURL)
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: data)
        } catch {
            if let diagnostic = ("DSH-Portable launcher log failed: \(error.localizedDescription)\n").data(using: .utf8) {
                FileHandle.standardError.write(diagnostic)
            }
        }
    }

    private let nativeBridgeScript = """
    (() => {
      if (window.__DSH_PORTABLE_NATIVE__) return;
      const listeners = new Set();
      Object.defineProperty(window, '__DSH_PORTABLE_NATIVE__', {
        configurable: false,
        value: Object.freeze({
          capabilities: Object.freeze({
            pickDirectory: true, saveDataPackage: true, openDataPackage: true,
            importData: true, restartHost: true, preferences: true, sessionProjection: true
          }),
          postMessage(message) { window.webkit.messageHandlers.dshPortable.postMessage(message); },
          addEventListener(name, listener) { if (name === 'message') listeners.add(listener); },
          removeEventListener(name, listener) { if (name === 'message') listeners.delete(listener); },
          __emit(message) { for (const listener of [...listeners]) listener({ data: message }); }
        })
      });
    })();
    """

    private var updateCheckEnabled: Bool {
        get {
            guard let data = try? Data(contentsOf: launcherSettingsURL),
                  let settings = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
            return settings["productUpdateCheckEnabled"] as? Bool
                ?? settings["updateCheckEnabled"] as? Bool ?? false
        }
        set {
            var settings: [String: Any] = [:]
            if let data = try? Data(contentsOf: launcherSettingsURL),
               let existing = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                settings = existing
            }
            settings["schemaVersion"] = 2
            settings["updateCheckEnabled"] = newValue
            settings["productUpdateCheckEnabled"] = newValue
            guard let data = try? JSONSerialization.data(withJSONObject: settings, options: [.sortedKeys]) else { return }
            try? FileManager.default.createDirectory(at: productDataRoot, withIntermediateDirectories: true)
            try? data.write(to: launcherSettingsURL, options: .atomic)
        }
    }

    private var installUpdateAtNextLaunch: Bool {
        get {
            guard let data = try? Data(contentsOf: launcherSettingsURL),
                  let settings = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
            return settings["installUpdateAtNextLaunch"] as? Bool ?? false
        }
        set {
            var settings: [String: Any] = [:]
            if let data = try? Data(contentsOf: launcherSettingsURL),
               let existing = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                settings = existing
            }
            settings["schemaVersion"] = 2
            settings["installUpdateAtNextLaunch"] = newValue
            guard let data = try? JSONSerialization.data(withJSONObject: settings, options: [.sortedKeys]) else { return }
            try? FileManager.default.createDirectory(at: productDataRoot, withIntermediateDirectories: true)
            try? data.write(to: launcherSettingsURL, options: .atomic)
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        configureApplicationMenu()
        createWindow()
        NSApp.activate(ignoringOtherApps: true)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.launchDesktop()
        }
    }

    private func configureApplicationMenu() {
        let main = NSMenu()
        let applicationItem = NSMenuItem()
        let applicationMenu = NSMenu()
        applicationItem.submenu = applicationMenu
        main.addItem(applicationItem)

        let about = NSMenuItem(title: L("关于 DSH-Portable", "About DSH-Portable"),
                               action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        about.target = NSApp
        applicationMenu.addItem(about)
        applicationMenu.addItem(.separator())

        productUpdateMenuItem = NSMenuItem(title: L("检查 DSH-Portable 更新…", "Check DSH-Portable Updates…"),
                                           action: #selector(checkForUpdatesFromMenu(_:)), keyEquivalent: "")
        productUpdateMenuItem.target = self
        productUpdateMenuItem.representedObject = "product"
        applicationMenu.addItem(productUpdateMenuItem)
        engineUpdateMenuItem = NSMenuItem(title: L("检查 DeepSeek Harness 更新…", "Check DeepSeek Harness Updates…"),
                                          action: #selector(checkForUpdatesFromMenu(_:)), keyEquivalent: "")
        engineUpdateMenuItem.target = self
        engineUpdateMenuItem.representedObject = "engine"
        applicationMenu.addItem(engineUpdateMenuItem)
        automaticUpdateMenuItem = NSMenuItem(title: L("启动时检查更新", "Check for updates at startup"),
                                             action: #selector(toggleAutomaticUpdateChecks(_:)), keyEquivalent: "")
        automaticUpdateMenuItem.target = self
        refreshAutomaticUpdateMenuItem()
        applicationMenu.addItem(automaticUpdateMenuItem)

        let terminal = NSMenuItem(title: L("DSH 终端…", "DSH Terminal…"),
                                  action: #selector(openDshTerminal(_:)), keyEquivalent: "")
        terminal.target = self
        applicationMenu.addItem(terminal)

        let report = NSMenuItem(title: L("反馈问题", "Report a Problem"),
                                action: #selector(reportProblem(_:)), keyEquivalent: "")
        report.target = self
        applicationMenu.addItem(report)
        applicationMenu.addItem(.separator())
        let quit = NSMenuItem(title: L("退出 DSH-Portable", "Quit DSH-Portable"),
                             action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        quit.target = NSApp
        applicationMenu.addItem(quit)

        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: L("编辑", "Edit"))
        editItem.submenu = editMenu
        main.addItem(editItem)
        editMenu.addItem(withTitle: L("撤销", "Undo"), action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: L("重做", "Redo"), action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: L("剪切", "Cut"), action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: L("复制", "Copy"), action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: L("粘贴", "Paste"), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: L("全选", "Select All"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        NSApp.mainMenu = main
    }

    @objc private func toggleAutomaticUpdateChecks(_ sender: NSMenuItem) {
        let enabled = !(updateCheckEnabled && engineUpdateCheckEnabled)
        updateCheckEnabled = enabled
        engineUpdateCheckEnabled = enabled
        refreshAutomaticUpdateMenuItem()
    }

    private func refreshAutomaticUpdateMenuItem() {
        automaticUpdateMenuItem.state = updateCheckEnabled && engineUpdateCheckEnabled ? .on
            : (!updateCheckEnabled && !engineUpdateCheckEnabled ? .off : .mixed)
    }

    @objc private func reportProblem(_ sender: NSMenuItem) {
        NSWorkspace.shared.open(URL(string: "https://github.com/WSL043/DSH-Portable/issues/new?template=bug-report.yml")!)
    }

    private var engineUpdateCheckEnabled: Bool {
        get {
            guard let data = try? Data(contentsOf: launcherSettingsURL),
                  let settings = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
            return settings["engineUpdateCheckEnabled"] as? Bool
                ?? settings["updateCheckEnabled"] as? Bool ?? false
        }
        set {
            var settings: [String: Any] = [:]
            if let data = try? Data(contentsOf: launcherSettingsURL),
               let existing = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { settings = existing }
            settings["schemaVersion"] = 2
            settings["engineUpdateCheckEnabled"] = newValue
            guard let data = try? JSONSerialization.data(withJSONObject: settings, options: [.sortedKeys]) else { return }
            try? FileManager.default.createDirectory(at: productDataRoot, withIntermediateDirectories: true)
            try? data.write(to: launcherSettingsURL, options: .atomic)
        }
    }

    private var pendingUpdateScope: String {
        get {
            guard let data = try? Data(contentsOf: launcherSettingsURL),
                  let settings = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return "product" }
            return settings["pendingUpdateScope"] as? String == "engine" ? "engine" : "product"
        }
        set {
            var settings: [String: Any] = [:]
            if let data = try? Data(contentsOf: launcherSettingsURL),
               let existing = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { settings = existing }
            settings["schemaVersion"] = 2
            settings["pendingUpdateScope"] = newValue == "engine" ? "engine" : "product"
            guard let data = try? JSONSerialization.data(withJSONObject: settings, options: [.sortedKeys]) else { return }
            try? FileManager.default.createDirectory(at: productDataRoot, withIntermediateDirectories: true)
            try? data.write(to: launcherSettingsURL, options: .atomic)
        }
    }

    @objc private func openDshTerminal(_ sender: NSMenuItem) {
        let helper = runtimeRoot.appendingPathComponent("launcher/dsh-terminal.command")
        guard FileManager.default.isExecutableFile(atPath: helper.path),
              NSWorkspace.shared.open(helper) else {
            let alert = NSAlert()
            alert.messageText = L("无法打开 DSH 终端", "Could not open DSH Terminal")
            alert.informativeText = L("便携终端文件缺失或无法运行，请重新下载并完整解压。",
                                      "The Portable terminal is missing or cannot run. Download and extract the package again.")
            alert.runModal()
            return
        }
    }

    @objc private func checkForUpdatesFromMenu(_ sender: NSMenuItem) {
        guard !manualUpdateRunning else { return }
        let scope = sender.representedObject as? String == "engine" ? "engine" : "product"
        manualUpdateRunning = true
        productUpdateMenuItem.isEnabled = false
        engineUpdateMenuItem.isEnabled = false
        let originalTitle = sender.title
        sender.title = L("正在检查…", "Checking…")
        DispatchQueue.global(qos: .userInitiated).async { [weak self, weak sender] in
            guard let self = self else { return }
            let result = try? self.runCLI(["check-update", "--scope", scope, "--json", "--force"])
            DispatchQueue.main.async {
                self.presentManualUpdateResult(result, scope: scope)
                self.manualUpdateRunning = false
                self.productUpdateMenuItem.isEnabled = true
                self.engineUpdateMenuItem.isEnabled = true
                sender?.title = originalTitle
            }
        }
    }

    private func presentManualUpdateResult(_ update: [String: Any]?, scope: String) {
        let alert = NSAlert()
        let engineScope = scope == "engine"
        let target = engineScope ? "DeepSeek Harness" : "DSH-Portable"
        let status = update?["status"] as? String ?? "unavailable"
        if status == "current" {
            alert.messageText = target + L(" 已是最新版", " is up to date")
            alert.informativeText = updateDescription(update, fullPackage: false, scope: scope)
            alert.runModal()
            return
        }
        if status == "core-incompatible" {
            alert.messageText = L("需要先更新 DSH-Portable", "Update DSH-Portable first")
            alert.informativeText = L("此 DeepSeek Harness 版本需要较新的 DSH-Portable。",
                                      "This DeepSeek Harness version needs a newer DSH-Portable.")
            alert.runModal()
            return
        }
        if status == "full-package-required" || (status == "available" && installedMode) {
            alert.messageText = L("DSH-Portable 需要完整更新", "DSH-Portable needs a complete update")
            alert.informativeText = updateDescription(update, fullPackage: true)
            alert.addButton(withTitle: L("打开下载页", "Open Download Page"))
            alert.addButton(withTitle: L("稍后", "Later"))
            alert.addButton(withTitle: L("跳过此版本", "Skip This Version"))
            let choice = alert.runModal()
            if choice == .alertFirstButtonReturn {
                if let value = update?["releaseUrl"] as? String,
                   let target = URL(string: value),
                   target.scheme == "https",
                   target.host == "github.com",
                   target.path.hasPrefix("/WSL043/DSH-Portable/releases/tag/v") {
                    NSWorkspace.shared.open(target)
                }
            } else if choice == .alertThirdButtonReturn {
                DispatchQueue.global().async { [weak self] in _ = try? self?.runCLI(["ignore-update", "--scope", scope, "--json"]) }
            } else {
                DispatchQueue.global().async { [weak self] in _ = try? self?.runCLI(["defer-update", "--scope", scope, "--json"]) }
            }
            return
        }
        if status == "available" {
            alert.messageText = target + L(" 有可用更新", " update is available")
            alert.informativeText = updateDescription(update, fullPackage: false, scope: scope) + "\n\n" +
                L("为避免中断正在运行的任务，可选择在下次启动前安装。当前任务不会被停止。",
                  "To avoid interrupting running work, install before the next launch. The current task will not be stopped.")
            alert.addButton(withTitle: L("下次启动时更新", "Update at Next Launch"))
            alert.addButton(withTitle: L("稍后", "Later"))
            alert.addButton(withTitle: L("跳过此版本", "Skip This Version"))
            let choice = alert.runModal()
            if choice == .alertFirstButtonReturn {
                pendingUpdateScope = scope
                installUpdateAtNextLaunch = true
            } else if choice == .alertThirdButtonReturn {
                DispatchQueue.global().async { [weak self] in _ = try? self?.runCLI(["ignore-update", "--scope", scope, "--json"]) }
            } else {
                DispatchQueue.global().async { [weak self] in _ = try? self?.runCLI(["defer-update", "--scope", scope, "--json"]) }
            }
            return
        }
        alert.messageText = L("现在无法检查更新", "Could not check for updates")
        alert.informativeText = L("请稍后再试。", "Try again later.")
        alert.runModal()
    }

    private func updateDescription(_ update: [String: Any]?, fullPackage: Bool, scope: String = "product") -> String {
        let productCurrent = update?["productCurrent"] as? String ?? update?["current"] as? String ?? ""
        let productLatest = update?["productLatest"] as? String ?? update?["latest"] as? String ?? productCurrent
        let engineCurrent = update?["engineCurrent"] as? String ?? ""
        let engineLatest = update?["engineLatest"] as? String ?? engineCurrent
        if scope == "engine" {
            return "DeepSeek Harness \(engineCurrent)  →  \(engineLatest)\n" +
                L("交付方式：轻量内核更新", "Delivery: lightweight engine update")
        }
        let product = "DSH-Portable \(productCurrent)  →  \(productLatest)"
        let engine = engineCurrent != engineLatest
            ? L("内置官方 DSH \(engineCurrent)  →  \(engineLatest)", "Bundled official DSH \(engineCurrent)  →  \(engineLatest)")
            : L("内置官方 DSH \(engineLatest)（本次不变）", "Bundled official DSH \(engineLatest) (unchanged)")
        let delivery = fullPackage
            ? L("交付方式：完整更新", "Delivery: complete package")
            : L("交付方式：轻量更新（仅下载已变更的 DSH 应用组件）",
                "Delivery: component update (only the changed DSH application component)")
        return [product, engine, delivery].joined(separator: "\n")
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if allowingClose { return .terminateNow }
        saveWindowFrame()
        beginShutdown()
        return .terminateLater
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if allowingClose { return true }
        saveWindowFrame()
        beginShutdown()
        return false
    }

    func windowDidEndLiveResize(_ notification: Notification) {
        saveWindowFrame()
    }

    func windowDidMove(_ notification: Notification) {
        saveWindowFrame()
    }

    private func createWindow() {
        let frame = NSRect(x: 0, y: 0, width: 520, height: 180)
        window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "DeepSeek-Herness"
        window.minSize = NSSize(width: 900, height: 620)
        window.center()
        window.delegate = self

        let content = NSView(frame: frame)
        content.autoresizingMask = [.width, .height]
        window.contentView = content

        statusLabel = NSTextField(labelWithString: L("正在启动 DeepSeek Harness…", "Starting DeepSeek Harness…"))
        statusLabel.font = NSFont.systemFont(ofSize: 15, weight: .medium)
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(statusLabel)

        spinner = NSProgressIndicator()
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.startAnimation(nil)
        content.addSubview(spinner)

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController.add(self, name: "dshPortable")
        configuration.userContentController.addUserScript(WKUserScript(
            source: nativeBridgeScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.isHidden = true
        content.addSubview(webView)

        NSLayoutConstraint.activate([
            spinner.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 28),
            spinner.centerYAnchor.constraint(equalTo: content.centerYAnchor),
            statusLabel.leadingAnchor.constraint(equalTo: spinner.trailingAnchor, constant: 12),
            statusLabel.trailingAnchor.constraint(lessThanOrEqualTo: content.trailingAnchor, constant: -28),
            statusLabel.centerYAnchor.constraint(equalTo: content.centerYAnchor),
            webView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            webView.topAnchor.constraint(equalTo: content.topAnchor),
            webView.bottomAnchor.constraint(equalTo: content.bottomAnchor),
        ])
        window.makeKeyAndOrderFront(nil)
    }

    private func launchDesktop() {
        do {
            guard FileManager.default.isExecutableFile(atPath: nodeURL.path),
                  FileManager.default.fileExists(atPath: cliURL.path) else {
                throw HostError.incomplete
            }
            applyPendingUpdateBeforeStartup()
            let result = try runCLI(["start", "--no-browser", "--json"])
            backendStarted = true
            guard let value = result["url"] as? String,
                  let url = URL(string: value),
                  url.scheme == "http",
                  (url.host == "127.0.0.1" || url.host == "localhost"),
                  (3080...3180).contains(url.port ?? 0) else {
                throw HostError.invalidURL
            }
            applicationURL = url
            DispatchQueue.main.sync { [weak self] in self?.showWebView(url) }
            checkForUpdateAfterStartup()
        } catch {
            if let diagnostic = ("DSH-Portable startup failed: \(error.localizedDescription)\n").data(using: .utf8) {
                FileHandle.standardError.write(diagnostic)
            }
            if backendStarted {
                _ = try? runCLI(["stop", "--no-browser", "--json"])
                backendStarted = false
            }
            DispatchQueue.main.async { [weak self] in self?.showFailure(error) }
        }
    }

    private func applyPendingUpdateBeforeStartup() {
        guard installUpdateAtNextLaunch else { return }
        do {
            _ = try runCLI(["update", "--scope", pendingUpdateScope, "--no-browser", "--json", "--progress-json"], progressHandler: { [weak self] progress in
                self?.presentUpdateProgress(progress)
            })
            installUpdateAtNextLaunch = false
        } catch {
            DispatchQueue.main.async { [weak self] in self?.showFailureAlert(error) }
        }
    }

    private func checkForUpdateAfterStartup() {
        if ProcessInfo.processInfo.environment["DSH_PORTABLE_SKIP_UPDATE_CHECK"] == "1"
            || CommandLine.arguments.contains("--skip-update-check") { return }
        if updateCheckEnabled { checkForUpdateAfterStartup(scope: "product") }
        if engineUpdateCheckEnabled { checkForUpdateAfterStartup(scope: "engine") }
    }

    private func checkForUpdateAfterStartup(scope: String) {
        guard let update = try? runCLI(["check-update", "--scope", scope, "--json"]),
              let status = update["status"] as? String,
              status == "available" || status == "full-package-required" else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if status == "available" && !self.installedMode {
                self.presentManualUpdateResult(update, scope: scope)
            } else {
                var complete = update
                complete["status"] = "full-package-required"
                self.presentManualUpdateResult(complete, scope: scope)
            }
        }
    }

    private func presentUpdateProgress(_ progress: [String: Any]) {
        let phase = progress["phase"] as? String ?? ""
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if phase == "downloading" {
                let percent = progress["percent"] as? Int ?? 0
                let received = progress["receivedBytes"] as? Int ?? 0
                let total = progress["totalBytes"] as? Int ?? 0
                self.statusLabel.stringValue = L("正在下载 DSH-Portable 更新…", "Downloading the DSH-Portable update…")
                    + " \(percent)%  ·  \(self.formatBytes(received)) / \(self.formatBytes(total))"
            } else if phase == "verifying" {
                self.statusLabel.stringValue = L("正在验证 DSH-Portable 更新…", "Verifying the DSH-Portable update…")
            } else if phase == "installing" {
                self.statusLabel.stringValue = L("正在安装 DSH-Portable 更新…", "Installing the DSH-Portable update…")
            } else if phase == "complete" {
                self.statusLabel.stringValue = L("DSH-Portable 更新完成，正在重新打开…", "DSH-Portable updated. Reopening…")
            }
        }
    }

    private func formatBytes(_ bytes: Int) -> String {
        if bytes < 1024 { return "\(max(0, bytes)) B" }
        if bytes < 1024 * 1024 { return String(format: "%.1f KB", Double(bytes) / 1024) }
        return String(format: "%.1f MB", Double(bytes) / 1024 / 1024)
    }

    private func showWebView(_ url: URL) {
        statusLabel.isHidden = true
        spinner.stopAnimation(nil)
        spinner.isHidden = true
        webView.isHidden = false
        if !restoreWindowFrame() {
            window.setContentSize(NSSize(width: 1280, height: 820))
            window.center()
        }
        webView.load(URLRequest(url: url))
    }

    private func restoreWindowFrame() -> Bool {
        guard let data = try? Data(contentsOf: windowStateURL),
              let state = try? JSONDecoder().decode(WindowFrameState.self, from: data),
              state.schemaVersion == 1 else { return false }
        let frame = NSRect(x: state.x, y: state.y, width: state.width, height: state.height)
        guard frame.width >= 900, frame.height >= 620 else { return false }
        let isVisible = NSScreen.screens.contains { screen in
            let intersection = screen.visibleFrame.intersection(frame)
            return intersection.width >= 120 && intersection.height >= 80
        }
        guard isVisible else { return false }
        window.setFrame(frame, display: false)
        return true
    }

    private func saveWindowFrame() {
        guard webView != nil, !webView.isHidden else { return }
        let frame = window.frame
        guard frame.width >= 900, frame.height >= 620 else { return }
        let state = WindowFrameState(
            schemaVersion: 1,
            x: frame.origin.x,
            y: frame.origin.y,
            width: frame.width,
            height: frame.height
        )
        guard let data = try? JSONEncoder().encode(state) else { return }
        try? FileManager.default.createDirectory(at: productDataRoot, withIntermediateDirectories: true)
        try? data.write(to: windowStateURL, options: .atomic)
    }

    private func beginShutdown() {
        guard !shuttingDown else { return }
        saveWindowFrame()
        shuttingDown = true
        window.title = L("DeepSeek-Herness · 正在关闭", "DeepSeek-Herness · Closing")
        webView.isHidden = true
        statusLabel.stringValue = L("正在安全停止 DeepSeek Harness…", "Stopping DeepSeek Harness safely…")
        statusLabel.isHidden = false
        spinner.isHidden = false
        spinner.startAnimation(nil)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            do {
                _ = try self.runCLI(["stop", "--no-browser", "--json"])
                self.backendStarted = false
                DispatchQueue.main.async {
                    if self.restartAfterShutdown { self.scheduleNativeRelaunch() }
                    self.allowingClose = true
                    NSApp.terminate(nil)
                }
            } catch {
                DispatchQueue.main.async {
                    self.shuttingDown = false
                    self.restartAfterShutdown = false
                    self.window.title = "DeepSeek-Herness"
                    self.webView.isHidden = false
                    self.statusLabel.isHidden = true
                    self.spinner.stopAnimation(nil)
                    self.spinner.isHidden = true
                    self.showFailureAlert(error)
                }
            }
        }
    }

    private func trustedBridgeMessage(_ message: WKScriptMessage) -> Bool {
        guard message.frameInfo.isMainFrame,
              let target = message.frameInfo.request.url,
              let applicationURL = applicationURL else { return false }
        return target.scheme == applicationURL.scheme
            && target.host == applicationURL.host
            && target.port == applicationURL.port
    }

    private func validRequestID(_ value: Any?, prefix: String) -> String? {
        guard let requestID = value as? String,
              requestID.range(of: "^\(NSRegularExpression.escapedPattern(for: prefix))[A-Za-z0-9-]{1,96}$",
                              options: .regularExpression) != nil else { return nil }
        return requestID
    }

    private func postBridgeMessage(_ value: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.__DSH_PORTABLE_NATIVE__?.__emit(\(json));")
    }

    private func mergeLauncherPreferences(_ message: [String: Any]) {
        var settings: [String: Any] = [:]
        if let data = try? Data(contentsOf: launcherSettingsURL),
           let existing = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { settings = existing }
        settings["schemaVersion"] = 2
        for key in ["updateChannel", "productUpdateCheckEnabled", "engineUpdateCheckEnabled", "taskNotificationsEnabled", "closeBehavior"] {
            if let value = message[key] { settings[key] = value }
        }
        if let product = settings["productUpdateCheckEnabled"] as? Bool { settings["updateCheckEnabled"] = product }
        guard let data = try? JSONSerialization.data(withJSONObject: settings, options: [.sortedKeys]) else { return }
        try? FileManager.default.createDirectory(at: productDataRoot, withIntermediateDirectories: true)
        try? data.write(to: launcherSettingsURL, options: .atomic)
        refreshAutomaticUpdateMenuItem()
    }

    private func showDirectoryPicker(requestID: String) {
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        let panel = NSOpenPanel()
        panel.title = L("选择工作区文件夹", "Select a workspace folder")
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        let portableWorkspace = runtimeRoot.appendingPathComponent("workspace")
        if FileManager.default.fileExists(atPath: portableWorkspace.path) { panel.directoryURL = portableWorkspace }
        let response = panel.runModal()
        var result: [String: Any] = ["type": "dsh-portable/pick-directory-result", "schemaVersion": 1, "requestId": requestID]
        if response == .OK, let selected = panel.url { result["path"] = selected.standardizedFileURL.path }
        else { result["cancelled"] = true }
        postBridgeMessage(result)
    }

    private func showDataExportPicker(requestID: String, kind: String) {
        let panel = NSSavePanel()
        let support = kind == "support"
        let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let prefix = support ? "DSH-Portable-support-" : (kind == "private" ? "DSH-Portable-private-" : "DSH-Portable-data-")
        panel.title = support ? L("选择支持报告保存位置", "Choose where to save the support report")
            : L("选择数据包保存位置", "Choose where to save the data package")
        panel.nameFieldStringValue = prefix + stamp + (support ? ".json" : ".dshdata")
        panel.allowedFileTypes = [support ? "json" : "dshdata"]
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        let response = panel.runModal()
        var result: [String: Any] = ["type": "dsh-portable/pick-data-export-result", "schemaVersion": 1, "requestId": requestID]
        if response == .OK, let selected = panel.url { result["path"] = selected.standardizedFileURL.path }
        else { result["cancelled"] = true }
        postBridgeMessage(result)
    }

    private func showDataImportPicker(requestID: String) {
        let panel = NSOpenPanel()
        panel.title = L("选择要导入的数据包", "Choose a data package to import")
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowsMultipleSelection = false
        panel.allowedFileTypes = ["dshdata"]
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        let response = panel.runModal()
        var result: [String: Any] = ["type": "dsh-portable/pick-data-import-result", "schemaVersion": 1, "requestId": requestID]
        if response == .OK, let selected = panel.url { result["path"] = selected.standardizedFileURL.path }
        else { result["cancelled"] = true }
        postBridgeMessage(result)
    }

    private func scheduleNativeRelaunch() {
        let helper = Process()
        helper.executableURL = URL(fileURLWithPath: "/bin/sh")
        helper.arguments = [
            "-c",
            "while kill -0 \"$1\" 2>/dev/null; do sleep 0.1; done; exec /usr/bin/open -n \"$2\"",
            "dsh-portable-restart",
            String(ProcessInfo.processInfo.processIdentifier),
            Bundle.main.bundleURL.path,
        ]
        helper.standardInput = FileHandle.nullDevice
        helper.standardOutput = FileHandle.nullDevice
        helper.standardError = FileHandle.nullDevice
        try? helper.run()
    }

    private func requestNativeRestart(requestID: String) {
        var result: [String: Any] = [
            "type": "dsh-portable/restart-host-result", "schemaVersion": 1, "requestId": requestID,
        ]
        if shuttingDown {
            result["ok"] = false
            result["error"] = L("正在关闭，请稍候。", "The app is already closing.")
        } else if hasRunningSession {
            result["ok"] = false
            result["error"] = L("任务仍在运行；完成后再重启即可，当前任务不会被中断。",
                                "A task is still running. Restart after it finishes; the current task was not interrupted.")
        } else {
            result["ok"] = true
            restartAfterShutdown = true
        }
        postBridgeMessage(result)
        if restartAfterShutdown { beginShutdown() }
    }

    private func importData(_ message: [String: Any]) {
        guard !shuttingDown, !hasRunningSession,
              let input = message["input"] as? String,
              FileManager.default.fileExists(atPath: input),
              ["keep", "replace"].contains(message["conflict"] as? String ?? "") else { return }
        let password = message["password"] as? String ?? ""
        guard password.isEmpty || password.count >= 8 else { return }
        shuttingDown = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            var passwordURL: URL?
            var backendWasStopped = false
            do {
                _ = try self.runCLI(["stop", "--no-browser", "--json"])
                backendWasStopped = true
                self.backendStarted = false
                var arguments = ["restore-data", "--input", input, "--conflict", message["conflict"] as! String, "--json"]
                if !password.isEmpty {
                    let runtime = self.productDataRoot.appendingPathComponent("runtime")
                    try FileManager.default.createDirectory(at: runtime, withIntermediateDirectories: true)
                    let target = runtime.appendingPathComponent("import-password-\(UUID().uuidString).txt")
                    try password.data(using: .utf8)!.write(to: target, options: [.atomic])
                    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target.path)
                    passwordURL = target
                    arguments += ["--password-file", target.path]
                }
                _ = try self.runCLI(arguments)
                if let passwordURL = passwordURL { try? FileManager.default.removeItem(at: passwordURL) }
                DispatchQueue.main.async {
                    self.scheduleNativeRelaunch()
                    self.allowingClose = true
                    NSApp.terminate(nil)
                }
            } catch {
                if let passwordURL = passwordURL { try? FileManager.default.removeItem(at: passwordURL) }
                DispatchQueue.main.async {
                    self.showFailureAlert(error)
                    if backendWasStopped {
                        self.scheduleNativeRelaunch()
                        self.allowingClose = true
                        NSApp.terminate(nil)
                    } else {
                        self.shuttingDown = false
                    }
                }
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "dshPortable", trustedBridgeMessage(message),
              let body = message.body as? [String: Any],
              let type = body["type"] as? String,
              (body["schemaVersion"] as? Int) == 1 else { return }
        switch type {
        case "dsh-portable/preferences": mergeLauncherPreferences(body)
        case "dsh-portable/state": hasRunningSession = body["hasRunningSession"] as? Bool ?? false
        case "dsh-portable/pick-directory":
            if let requestID = validRequestID(body["requestId"], prefix: "workspace-") { showDirectoryPicker(requestID: requestID) }
        case "dsh-portable/pick-data-export":
            if let requestID = validRequestID(body["requestId"], prefix: "data-export-"),
               let kind = body["kind"] as? String, ["standard", "private", "support"].contains(kind) {
                showDataExportPicker(requestID: requestID, kind: kind)
            }
        case "dsh-portable/pick-data-import":
            if let requestID = validRequestID(body["requestId"], prefix: "data-import-") { showDataImportPicker(requestID: requestID) }
        case "dsh-portable/import-data": importData(body)
        case "dsh-portable/restart-host":
            if let requestID = validRequestID(body["requestId"], prefix: "host-restart-") { requestNativeRestart(requestID: requestID) }
        default: break
        }
    }

    private func runCLI(_ arguments: [String], progressHandler: (([String: Any]) -> Void)? = nil) throws -> [String: Any] {
        let process = Process()
        process.executableURL = nodeURL
        process.arguments = [cliURL.path] + arguments
        process.currentDirectoryURL = runtimeRoot
        var environment = ProcessInfo.processInfo.environment
        if installedMode && environment["DSH_PORTABLE_STATE_ROOT"] == nil {
            environment["DSH_PORTABLE_STATE_ROOT"] = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Application Support/DeepSeek-Herness").path
        }
        process.environment = environment
        let output = Pipe()
        let errors = Pipe()
        process.standardOutput = output
        process.standardError = errors
        try process.run()
        var pending = Data()
        var resultLines: [String] = []
        while true {
            let chunk = output.fileHandleForReading.availableData
            if chunk.isEmpty { break }
            pending.append(chunk)
            while let newline = pending.firstIndex(of: 0x0A) {
                let lineData = pending.subdata(in: pending.startIndex..<newline)
                pending.removeSubrange(pending.startIndex...newline)
                collectCLILine(lineData, progressHandler: progressHandler, resultLines: &resultLines)
            }
        }
        if !pending.isEmpty { collectCLILine(pending, progressHandler: progressHandler, resultLines: &resultLines) }
        process.waitUntilExit()
        let stdout = resultLines.joined(separator: "\n")
        let stderr = String(data: errors.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        guard process.terminationStatus == 0 else {
            throw HostError.commandFailed((stderr + "\n" + stdout).trimmingCharacters(in: .whitespacesAndNewlines))
        }
        guard let data = stdout.data(using: .utf8),
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw HostError.commandFailed(L("DeepSeek Harness 返回了无法识别的结果。",
                                            "DeepSeek Harness returned an unrecognized result."))
        }
        return json
    }

    private func collectCLILine(_ data: Data, progressHandler: (([String: Any]) -> Void)?, resultLines: inout [String]) {
        guard !data.isEmpty, let line = String(data: data, encoding: .utf8), !line.isEmpty else { return }
        if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           object["type"] as? String == "update-progress" {
            progressHandler?(object)
        } else {
            resultLines.append(line)
        }
    }

    private func showFailure(_ error: Error) {
        showFailureAlert(error)
        allowingClose = true
        window.close()
    }

    private func showFailureAlert(_ error: Error) {
        let alert = NSAlert(error: error)
        alert.messageText = L("DeepSeek Harness 无法启动", "DeepSeek Harness could not start")
        alert.runModal()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let target = navigationAction.request.url else { decisionHandler(.cancel); return }
        if let applicationURL = applicationURL,
           target.host == applicationURL.host, target.port == applicationURL.port {
            decisionHandler(.allow)
            return
        }
        if target.scheme == "http" || target.scheme == "https" { NSWorkspace.shared.open(target) }
        decisionHandler(.cancel)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        writeLauncherLog("webview", "web-content-process-terminated")
        guard backendStarted, !shuttingDown, !allowingClose else {
            writeLauncherLog("webview-recovery", "ignored-during-shutdown")
            return
        }
        guard !webContentRecoveryPending, webContentRecoveryAttempts < 1 else {
            writeLauncherLog("webview-recovery", "failed reason=repeated-content-process-termination")
            if !webContentRecoveryFailureShown {
                webContentRecoveryFailureShown = true
                let alert = NSAlert()
                alert.messageText = L("工作台界面无法恢复", "The workspace interface could not recover")
                alert.informativeText = L(
                    "DeepSeek Harness 后端仍保持运行。请导出支持报告后重新打开应用。",
                    "The DeepSeek Harness backend remains running. Export a support report, then reopen the app.")
                alert.runModal()
            }
            return
        }

        webContentRecoveryPending = true
        webContentRecoveryAttempts += 1
        writeLauncherLog("webview-recovery", "begin mode=reload reason=content-process-terminated")
        webView.reload()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webContentRecoveryPending else { return }
        webContentRecoveryPending = false
        webContentRecoveryAttempts = 0
        webContentRecoveryFailureShown = false
        writeLauncherLog("webview-recovery", "complete")
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let target = navigationAction.request.url,
           target.scheme == "http" || target.scheme == "https" { NSWorkspace.shared.open(target) }
        return nil
    }
}

let application = NSApplication.shared
private let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()

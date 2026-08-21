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

private final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var statusLabel: NSTextField!
    private var spinner: NSProgressIndicator!
    private var applicationURL: URL?
    private var allowingClose = false
    private var shuttingDown = false
    private var backendStarted = false
    private var manualUpdateRunning = false
    private var automaticUpdateMenuItem: NSMenuItem!

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

    private var updateCheckEnabled: Bool {
        get {
            guard let data = try? Data(contentsOf: launcherSettingsURL),
                  let settings = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
            return settings["updateCheckEnabled"] as? Bool ?? false
        }
        set {
            var settings: [String: Any] = [:]
            if let data = try? Data(contentsOf: launcherSettingsURL),
               let existing = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                settings = existing
            }
            settings["schemaVersion"] = 1
            settings["updateCheckEnabled"] = newValue
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
            settings["schemaVersion"] = 1
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

        let check = NSMenuItem(title: L("检查更新…", "Check for Updates…"),
                               action: #selector(checkForUpdatesFromMenu(_:)), keyEquivalent: "")
        check.target = self
        applicationMenu.addItem(check)
        automaticUpdateMenuItem = NSMenuItem(title: L("启动时检查更新", "Check for updates at startup"),
                                             action: #selector(toggleAutomaticUpdateChecks(_:)), keyEquivalent: "")
        automaticUpdateMenuItem.target = self
        automaticUpdateMenuItem.state = updateCheckEnabled ? .on : .off
        applicationMenu.addItem(automaticUpdateMenuItem)

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
        updateCheckEnabled.toggle()
        sender.state = updateCheckEnabled ? .on : .off
    }

    @objc private func reportProblem(_ sender: NSMenuItem) {
        NSWorkspace.shared.open(URL(string: "https://github.com/WSL043/DSH-Portable/issues/new?template=bug-report.yml")!)
    }

    @objc private func checkForUpdatesFromMenu(_ sender: NSMenuItem) {
        guard !manualUpdateRunning else { return }
        manualUpdateRunning = true
        sender.isEnabled = false
        sender.title = L("正在检查…", "Checking…")
        DispatchQueue.global(qos: .userInitiated).async { [weak self, weak sender] in
            guard let self = self else { return }
            let result = try? self.runCLI(["check-update", "--json", "--force"])
            DispatchQueue.main.async {
                self.presentManualUpdateResult(result)
                self.manualUpdateRunning = false
                sender?.isEnabled = true
                sender?.title = L("检查更新…", "Check for Updates…")
            }
        }
    }

    private func presentManualUpdateResult(_ update: [String: Any]?) {
        let alert = NSAlert()
        let status = update?["status"] as? String ?? "unavailable"
        if status == "current" {
            alert.messageText = L("DSH-Portable 已是最新版", "DSH-Portable is up to date")
            alert.informativeText = updateDescription(update, fullPackage: false)
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
                DispatchQueue.global().async { [weak self] in _ = try? self?.runCLI(["ignore-update", "--json"]) }
            } else {
                DispatchQueue.global().async { [weak self] in _ = try? self?.runCLI(["defer-update", "--json"]) }
            }
            return
        }
        if status == "available" {
            alert.messageText = L("DSH-Portable 有可用更新", "A DSH-Portable update is available")
            alert.informativeText = updateDescription(update, fullPackage: false) + "\n\n" +
                L("为避免中断正在运行的任务，可选择在下次启动前安装。当前任务不会被停止。",
                  "To avoid interrupting running work, install before the next launch. The current task will not be stopped.")
            alert.addButton(withTitle: L("下次启动时更新", "Update at Next Launch"))
            alert.addButton(withTitle: L("稍后", "Later"))
            alert.addButton(withTitle: L("跳过此版本", "Skip This Version"))
            let choice = alert.runModal()
            if choice == .alertFirstButtonReturn {
                installUpdateAtNextLaunch = true
            } else if choice == .alertThirdButtonReturn {
                DispatchQueue.global().async { [weak self] in _ = try? self?.runCLI(["ignore-update", "--json"]) }
            } else {
                DispatchQueue.global().async { [weak self] in _ = try? self?.runCLI(["defer-update", "--json"]) }
            }
            return
        }
        alert.messageText = L("现在无法检查更新", "Could not check for updates")
        alert.informativeText = L("请稍后再试。", "Try again later.")
        alert.runModal()
    }

    private func updateDescription(_ update: [String: Any]?, fullPackage: Bool) -> String {
        let productCurrent = update?["productCurrent"] as? String ?? update?["current"] as? String ?? ""
        let productLatest = update?["productLatest"] as? String ?? update?["latest"] as? String ?? productCurrent
        let engineCurrent = update?["engineCurrent"] as? String ?? ""
        let engineLatest = update?["engineLatest"] as? String ?? engineCurrent
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
            _ = try runCLI(["update", "--no-browser", "--json", "--progress-json"], progressHandler: { [weak self] progress in
                self?.presentUpdateProgress(progress)
            })
            installUpdateAtNextLaunch = false
        } catch {
            DispatchQueue.main.async { [weak self] in self?.showFailureAlert(error) }
        }
    }

    private func checkForUpdateAfterStartup() {
        if !updateCheckEnabled
            || ProcessInfo.processInfo.environment["DSH_PORTABLE_SKIP_UPDATE_CHECK"] == "1"
            || CommandLine.arguments.contains("--skip-update-check") { return }
        guard let update = try? runCLI(["check-update", "--json"]),
              let status = update["status"] as? String,
              status == "available" || status == "full-package-required" else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if status == "available" && !self.installedMode {
                self.presentManualUpdateResult(update)
            } else {
                var complete = update
                complete["status"] = "full-package-required"
                self.presentManualUpdateResult(complete)
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
                    self.allowingClose = true
                    NSApp.terminate(nil)
                }
            } catch {
                DispatchQueue.main.async {
                    self.shuttingDown = false
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

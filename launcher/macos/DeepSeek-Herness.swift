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
                  let settings = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return true }
            return settings["updateCheckEnabled"] as? Bool ?? true
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
        let latest = update?["latest"] as? String ?? ""
        if status == "current" {
            alert.messageText = L("已经是最新版", "You're up to date")
            alert.informativeText = L("当前不需要更新。", "No update is needed right now.")
            alert.runModal()
            return
        }
        if status == "full-package-required" {
            alert.messageText = L("需要完整升级 \(latest)", "Complete package required \(latest)")
            alert.informativeText = L("要现在打开下载页吗？", "Open the download page now?")
            alert.addButton(withTitle: L("打开下载页", "Open Download Page"))
            alert.addButton(withTitle: L("稍后", "Later"))
            if alert.runModal() == .alertFirstButtonReturn {
                NSWorkspace.shared.open(URL(string: "https://github.com/WSL043/DSH-Portable/releases/latest")!)
            } else {
                DispatchQueue.global().async { [weak self] in _ = try? self?.runCLI(["defer-update", "--json"]) }
            }
            return
        }
        if status == "available" {
            alert.messageText = L("发现新版 \(latest)", "Update available \(latest)")
            alert.informativeText = L("为避免中断正在运行的任务，请在方便时退出并重新打开；启动时可以选择“现在更新”或“稍后”。",
                                      "To avoid interrupting a running task, quit and reopen when convenient. Startup will offer Update now or Later.")
            alert.runModal()
            return
        }
        alert.messageText = L("现在无法检查更新", "Could not check for updates")
        alert.informativeText = L("请稍后再试。", "Try again later.")
        alert.runModal()
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
            try checkAndApplyUpdate()
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
            DispatchQueue.main.async { [weak self] in self?.showWebView(url) }
        } catch {
            if backendStarted {
                _ = try? runCLI(["stop", "--no-browser", "--json"])
                backendStarted = false
            }
            DispatchQueue.main.async { [weak self] in self?.showFailure(error) }
        }
    }

    private func checkAndApplyUpdate() throws {
        if !updateCheckEnabled
            || ProcessInfo.processInfo.environment["DSH_PORTABLE_SKIP_UPDATE_CHECK"] == "1"
            || CommandLine.arguments.contains("--skip-update-check") { return }
        guard let update = try? runCLI(["check-update", "--json"]),
              let status = update["status"] as? String,
              status == "available" || status == "full-package-required" else { return }
        let latest = update["latest"] as? String ?? ""
        let accepted: Bool = DispatchQueue.main.sync {
            let alert = NSAlert()
            alert.messageText = status == "available" && !installedMode
                ? L("发现新版 \(latest)", "Update available \(latest)")
                : L("需要完整升级 \(latest)", "Complete package required \(latest)")
            alert.informativeText = status == "available" && !installedMode
                ? L("只下载已变化的 DSH 应用组件；设置、会话和工作区保持原位。",
                    "Only the changed DSH application component is downloaded. Settings, sessions, and workspace stay in place.")
                : L("安装新版不会覆盖设置、会话和工作区。",
                    "Installing the new version does not overwrite settings, sessions, or workspace.")
            alert.addButton(withTitle: status == "available" && !installedMode
                ? L("现在更新", "Update Now") : L("打开下载页", "Open Download Page"))
            alert.addButton(withTitle: L("稍后", "Later"))
            return alert.runModal() == .alertFirstButtonReturn
        }
        if accepted && status == "available" && !installedMode {
            _ = try runCLI(["update", "--no-browser", "--json"])
        } else {
            _ = try? runCLI(["defer-update", "--json"])
            if accepted {
                DispatchQueue.main.async {
                    NSWorkspace.shared.open(URL(string: "https://github.com/WSL043/DSH-Portable/releases/latest")!)
                }
            }
        }
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

    private func runCLI(_ arguments: [String]) throws -> [String: Any] {
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
        process.waitUntilExit()
        let stdout = String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
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

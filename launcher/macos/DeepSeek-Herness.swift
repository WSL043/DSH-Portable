import AppKit
import Foundation
import WebKit

private enum HostError: LocalizedError {
    case incomplete
    case commandFailed(String)
    case invalidURL

    var errorDescription: String? {
        switch self {
        case .incomplete:
            return "DeepSeek Harness 运行文件不完整。请重新下载并完整解压。"
        case .commandFailed(let details):
            return details
        case .invalidURL:
            return "DeepSeek Harness 返回了无效的本地地址。"
        }
    }
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

    func applicationDidFinishLaunching(_ notification: Notification) {
        createWindow()
        NSApp.activate(ignoringOtherApps: true)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.launchDesktop()
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if allowingClose { return .terminateNow }
        beginShutdown()
        return .terminateLater
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if allowingClose { return true }
        beginShutdown()
        return false
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

        statusLabel = NSTextField(labelWithString: "正在启动 DeepSeek Harness…")
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
        if ProcessInfo.processInfo.environment["DSH_PORTABLE_SKIP_UPDATE_CHECK"] == "1" { return }
        guard let update = try? runCLI(["check-update", "--json"]),
              let status = update["status"] as? String,
              status == "available" || status == "full-package-required" else { return }
        let latest = update["latest"] as? String ?? ""
        let accepted: Bool = DispatchQueue.main.sync {
            let alert = NSAlert()
            alert.messageText = status == "available" && !installedMode ? "发现新版 \(latest)" : "需要完整升级 \(latest)"
            alert.informativeText = status == "available" && !installedMode
                ? "只下载已变化的 DSH 应用组件；设置、会话和工作区保持原位。"
                : "安装新版不会覆盖设置、会话和工作区。"
            alert.addButton(withTitle: status == "available" && !installedMode ? "现在更新" : "打开下载页")
            alert.addButton(withTitle: "稍后")
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
        window.setContentSize(NSSize(width: 1280, height: 820))
        window.center()
        webView.load(URLRequest(url: url))
    }

    private func beginShutdown() {
        guard !shuttingDown else { return }
        shuttingDown = true
        window.title = "DeepSeek-Herness · 正在关闭"
        webView.isHidden = true
        statusLabel.stringValue = "正在安全停止 DeepSeek Harness…"
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
            throw HostError.commandFailed("DeepSeek Harness 返回了无法识别的结果。")
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
        alert.messageText = "DeepSeek Harness 无法启动"
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
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()

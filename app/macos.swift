import Cocoa
import WebKit

final class App: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var process: Process?
    var log: FileHandle?
    let url = URL(string: "http://127.0.0.1:8765")!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let root = Bundle.main.bundleURL.deletingLastPathComponent()
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 850),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Mi balance"
        window.minSize = NSSize(width: 420, height: 600)
        window.center()
        window.delegate = self
        let web = WKWebView(frame: window.contentView!.bounds)
        web.navigationDelegate = self
        web.autoresizingMask = [.width, .height]
        window.contentView = web
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        URLSession.shared.dataTask(with: url.appendingPathComponent("api/health")) { data, _, _ in
            let ours = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] }?["app"] == "mi-balance"
            DispatchQueue.main.async {
                if !ours {
                    let task = Process()
                    task.executableURL = URL(fileURLWithPath: "/Library/Frameworks/Python.framework/Versions/3.13/bin/python3")
                    task.arguments = [root.appendingPathComponent("app/server.py").path]
                    task.currentDirectoryURL = root
                    let logURL = root.appendingPathComponent("data/app.log")
                    try? FileManager.default.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
                    FileManager.default.createFile(atPath: logURL.path, contents: nil)
                    self.log = try? FileHandle(forWritingTo: logURL)
                    task.standardOutput = self.log; task.standardError = self.log
                    do { try task.run(); self.process = task }
                    catch { self.showError("No se pudo iniciar la app: \(error.localizedDescription)"); return }
                }
                self.load(web, attempt: 0)
            }
        }.resume()
    }
    func load(_ web: WKWebView, attempt: Int) {
        URLSession.shared.dataTask(with: url.appendingPathComponent("api/health")) { data, _, _ in
            DispatchQueue.main.async {
                if let data = data, let value = try? JSONSerialization.jsonObject(with: data) as? [String: String], value["app"] == "mi-balance" {
                    web.load(URLRequest(url: self.url))
                } else if attempt < 50 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { self.load(web, attempt: attempt + 1) }
                } else { self.showError("No se pudo abrir Mi Balance. Consulta data/app.log; puede que el puerto 8765 esté ocupado.") }
            }
        }.resume()
    }
    func showError(_ message: String) {
        let alert = NSAlert(); alert.messageText = "Mi Balance"; alert.informativeText = message; alert.runModal()
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let target = navigationAction.request.url, target.path == "/api/export.csv" {
            NSWorkspace.shared.open(target); decisionHandler(.cancel)
        } else { decisionHandler(.allow) }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) {
        if let task = process, task.isRunning { task.terminate(); task.waitUntilExit() }
        try? log?.close()
    }
}
let application = NSApplication.shared
application.setActivationPolicy(.regular)
let delegate = App()
application.delegate = delegate
application.run()

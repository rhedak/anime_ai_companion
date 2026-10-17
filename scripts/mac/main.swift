// The executable of Anaico.app. It starts the server (Resources/start.sh, which execs the bundled Node), keeps the app alive as long as
// the server runs, and stops the server when the app quits (Dock -> Quit, Cmd-Q). Clicking the Dock icon again shows the page.
import Cocoa

final class Delegate: NSObject, NSApplicationDelegate {
    var server: Process?
    let url = URL(string: "http://127.0.0.1:\(ProcessInfo.processInfo.environment["PORT"] ?? "3737")")!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let script = Bundle.main.resourceURL!.appendingPathComponent("start.sh").path
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [script]
        // The server ended (it crashed, or another copy was already running and start.sh only opened the page): nothing left to keep alive.
        process.terminationHandler = { _ in DispatchQueue.main.async { NSApp.terminate(nil) } }
        do { try process.run(); server = process } catch { NSApp.terminate(nil) }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        NSWorkspace.shared.open(url)
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        server?.terminationHandler = nil
        server?.terminate()
    }

    @objc func openPage(_ sender: Any?) { NSWorkspace.shared.open(url) }

    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        let menu = NSMenu()
        menu.addItem(withTitle: "Open in Browser", action: #selector(openPage(_:)), keyEquivalent: "")
        return menu
    }
}

let app = NSApplication.shared
let delegate = Delegate()
app.delegate = delegate
app.setActivationPolicy(.regular)

let main = NSMenu()
let appItem = NSMenuItem()
main.addItem(appItem)
let appMenu = NSMenu()
appMenu.addItem(withTitle: "Open in Browser", action: #selector(Delegate.openPage(_:)), keyEquivalent: "o").target = delegate
appMenu.addItem(.separator())
appMenu.addItem(withTitle: "Quit Anaico", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
appItem.submenu = appMenu
app.mainMenu = main

app.run()

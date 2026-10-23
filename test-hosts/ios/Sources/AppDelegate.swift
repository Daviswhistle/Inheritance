import UIKit
import WebKit

#if !DEBUG
#error("Inheritance test host must never be built for release")
#endif

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = TestHostViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}

final class TestHostViewController: UIViewController, WKNavigationDelegate, WKUIDelegate,
                                    WKScriptMessageHandler, UITextFieldDelegate {
    private var webView: WKWebView!
    private let address = UITextField()
    private let status = UILabel()
    private var allowedURL: URL?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 1, green: 0.965, blue: 0.843, alpha: 1)
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "minikit")
        configuration.userContentController.add(self, name: "viewportMetrics")
        // Read-only debug telemetry: accessibility exposes actual DOM geometry,
        // because XCTest can report only the clipped visible part of an input.
        configuration.userContentController.addUserScript(WKUserScript(source: """
            (() => {
              if (new URLSearchParams(location.search).get('trace') !== '1') return;
              let previous = '';
              const report = () => {
                const element = document.activeElement;
                const rect = element?.getBoundingClientRect();
                const viewport = window.visualViewport;
                const metrics = {innerHeight, innerWidth, scrollY,
                  viewport: viewport ? {height: viewport.height, width: viewport.width,
                    offsetTop: viewport.offsetTop, pageTop: viewport.pageTop, scale: viewport.scale} : null,
                  input: rect && element?.matches('input,textarea') ? {top: rect.top,
                    bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height,
                    width: rect.width, id: element.id} : null,
                  keyboard: document.documentElement.dataset.planKeyboard ?? null};
                const serialized = JSON.stringify(metrics);
                if (serialized !== previous) {
                  previous = serialized;
                  window.webkit.messageHandlers.viewportMetrics.postMessage(metrics);
                }
                requestAnimationFrame(report);
              };
              requestAnimationFrame(report);
            })();
            """, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        configuration.userContentController.addUserScript(WKUserScript(
            source: "window.__INHERITANCE_TEST_NATIVE_HOST__ = { platform: 'ios' };",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        status.text = "TEST HOST · iOS · local test funds only"
        status.font = .systemFont(ofSize: 12)
        status.accessibilityIdentifier = "test-host-status"
        address.text = UserDefaults.standard.string(forKey: "testURL") ?? "http://localhost:7777/"
        address.font = .systemFont(ofSize: 13)
        address.keyboardType = .URL
        address.autocapitalizationType = .none
        address.autocorrectionType = .no
        address.returnKeyType = .go
        address.borderStyle = .roundedRect
        address.delegate = self
        address.accessibilityLabel = "Local test server URL"
        let open = UIButton(type: .system)
        open.setTitle("Open", for: .normal)
        open.addTarget(self, action: #selector(openTestURL), for: .touchUpInside)
        let reload = UIButton(type: .system)
        reload.setTitle("↻", for: .normal)
        reload.accessibilityLabel = "Reload test page"
        reload.addTarget(self, action: #selector(reloadPage), for: .touchUpInside)
        let toolbar = UIStackView(arrangedSubviews: [address, open, reload])
        toolbar.spacing = 8
        let hostViews: [UIView] = [status, toolbar, webView!]
        hostViews.forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview($0)
        }
        NSLayoutConstraint.activate([
            status.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 4),
            status.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            status.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
            toolbar.topAnchor.constraint(equalTo: status.bottomAnchor, constant: 4),
            toolbar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 8),
            toolbar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -8),
            toolbar.heightAnchor.constraint(equalToConstant: 44),
            open.widthAnchor.constraint(equalToConstant: 48),
            reload.widthAnchor.constraint(equalToConstant: 44),
            webView.topAnchor.constraint(equalTo: toolbar.bottomAnchor, constant: 4),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            // Keep the embedded web viewport above UIKit keyboard/accessory views.
            webView.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)
        ])
        openTestURL()
    }

    @objc private func openTestURL() {
        guard let url = URL(string: address.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""),
              Self.isLocalTestURL(url) else {
            status.text = "Use http(s)://localhost or a private LAN IPv4 address"
            return
        }
        allowedURL = url
        UserDefaults.standard.set(url.absoluteString, forKey: "testURL")
        address.resignFirstResponder()
        webView.load(URLRequest(url: url))
    }

    @objc private func reloadPage() { webView.reload() }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool { openTestURL(); return true }

    private static func isLocalTestURL(_ url: URL) -> Bool {
        guard ["http", "https"].contains(url.scheme ?? ""), url.user == nil, url.password == nil,
              let host = url.host?.lowercased() else { return false }
        if ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host) { return true }
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return false }
        let octets = parts.compactMap { part -> Int? in
            guard part.count <= 3, !part.isEmpty,
                  part.allSatisfy({ $0 >= "0" && $0 <= "9" }),
                  let value = Int(part), value <= 255 else { return nil }
            return value
        }
        guard octets.count == 4 else { return false }
        return octets[0] == 10 || (octets[0] == 192 && octets[1] == 168)
            || (octets[0] == 172 && (16...31).contains(octets[1]))
    }

    private func sameOrigin(_ url: URL?) -> Bool {
        guard let url, let origin = allowedURL else { return false }
        let port = url.port ?? (url.scheme == "https" ? 443 : 80)
        let originPort = origin.port ?? (origin.scheme == "https" ? 443 : 80)
        return url.scheme == origin.scheme && url.host?.lowercased() == origin.host?.lowercased()
            && port == originPort && url.user == nil && url.password == nil
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        if message.name == "viewportMetrics" {
            guard message.frameInfo.isMainFrame, sameOrigin(message.frameInfo.request.url),
                  sameOrigin(webView.url), var metrics = message.body as? [String: Any] else { return }
            let frame = webView.convert(webView.bounds, to: view.window)
            metrics["nativeWebView"] = [frame.minX, frame.minY, frame.width, frame.height]
            let keyboardFrame = view.keyboardLayoutGuide.layoutFrame
            metrics["keyboardGuide"] = [keyboardFrame.minX, keyboardFrame.minY, keyboardFrame.width, keyboardFrame.height]
            if let data = try? JSONSerialization.data(withJSONObject: metrics, options: [.sortedKeys]),
               let value = String(data: data, encoding: .utf8) { status.accessibilityValue = value }
            return
        }
        guard message.name == "minikit", message.frameInfo.isMainFrame,
              sameOrigin(message.frameInfo.request.url), sameOrigin(webView.url),
              JSONSerialization.isValidJSONObject(message.body),
              let data = try? JSONSerialization.data(withJSONObject: message.body), data.count <= 1_000_000,
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("void(window.__INHERITANCE_TEST_HOST_RECEIVE__?.(\(json)))") { [weak self] _, error in
            if error != nil { self?.status.text = "TEST HOST · bridge handler failed; inspect Safari console" }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let allowed = sameOrigin(navigationAction.request.url)
        if !allowed { status.text = "TEST HOST · external navigation blocked" }
        decisionHandler(allowed ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        status.text = "TEST HOST · iOS · local test funds only"
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) {
        status.text = "TEST HOST · \(error.localizedDescription)"
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: "Test host", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }
}

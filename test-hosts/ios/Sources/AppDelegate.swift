import UIKit
import WebKit

#if !DEBUG
#error("Inheritance test host must never be built for release")
#endif

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = TestHostWindow(windowScene: windowScene)
        window.rootViewController = TestHostViewController()
        window.makeKeyAndVisible()
        self.window = window
    }
}

private final class TestHostWindow: UIWindow {
    override func sendEvent(_ event: UIEvent) {
        // Sample before UIKit dispatches the event to WebKit and its recognizers.
        (rootViewController as? TestHostViewController)?.recordWindowTouches(event)
        super.sendEvent(event)
    }
}

final class TestHostViewController: UIViewController, WKNavigationDelegate, WKUIDelegate,
                                    WKScriptMessageHandler, UITextFieldDelegate {
    private var webView: WKWebView!
    private let address = UITextField()
    private let status = UILabel()
    private var toolbar: UIStackView!
    private var toolbarHeight: NSLayoutConstraint!
    private var allowedURL: URL?
    private var webBottom: NSLayoutConstraint!
    private var keyboardScreenFrame: CGRect?
    private var lastViewportMetrics: [String: Any]?
    private var commandTrace: [[String: Any]] = []
    private var traceWindowTouches = false
    private var windowTouchTrace: [[String: Any]] = []

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
              const interactionTrace = [];
              const authTrace = [];
              const telemetryErrors = [];
              const identify = element => {
                if (!element) return null;
                if (typeof element.id === 'string' && element.id) return element.id;
                // SVG className is an SVGAnimatedString, not a bridge-safe string.
                const className = element.getAttribute?.('class');
                return className || (typeof element.tagName === 'string' ? element.tagName : null);
              };
              window.addEventListener('inheritance:auth-stage', event => {
                const {stage, at} = event.detail || {};
                if (typeof stage === 'string' && /^[a-z-]+$/.test(stage)) {
                  authTrace.push({stage, at});
                  if (authTrace.length > 40) authTrace.shift();
                }
              });
              for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'touchcancel', 'mousedown', 'mouseup', 'click', 'focusin', 'focusout']) {
                document.addEventListener(type, event => {
                  const target = event.target;
                  const button = target?.closest?.('button');
                  const point = event.changedTouches?.[0] || event;
                  const hit = Number.isFinite(point.clientX) ? document.elementFromPoint(point.clientX, point.clientY) : null;
                  const done = document.querySelector('.plan-keyboard-done');
                  const doneRect = done?.getBoundingClientRect();
                  const record = {type, buttonText: button?.textContent?.trim(), trusted: event.isTrusted,
                    target: identify(target), hit: identify(hit),
                    active: document.activeElement?.id, x: point.clientX, y: point.clientY,
                    done: doneRect ? [doneRect.x, doneRect.y, doneRect.width, doneRect.height] : null,
                    at: Math.round(performance.now())};
                  interactionTrace.push(record);
                  // Read the final flag after React's root handler has run.
                  setTimeout(() => record.prevented = event.defaultPrevented, 0);
                  if (interactionTrace.length > 24) interactionTrace.shift();
                }, true);
              }
              const sample = () => {
                const element = document.activeElement;
                const rect = element?.getBoundingClientRect();
                const doneRect = document.querySelector('.plan-keyboard-done')?.getBoundingClientRect();
                const intervalRect = document.querySelector('label[for="period-input"]')?.getBoundingClientRect();
                const viewport = window.visualViewport;
                const editing = rect && element?.matches('input,textarea');
                const hidden = selector => {
                  const node = document.querySelector(selector);
                  return !node || getComputedStyle(node).display === 'none';
                };
                // getBoundingClientRect and elementFromPoint use CSS viewport
                // coordinates. Interior samples avoid the input's rounded border.
                const hits = editing ? [rect.top + Math.min(12, rect.height / 4),
                  rect.top + rect.height / 2, rect.bottom - Math.min(12, rect.height / 4)]
                  .flatMap(y => [rect.left + Math.min(12, rect.width / 4),
                    rect.left + rect.width / 2, rect.right - Math.min(12, rect.width / 4)].map(x => {
                      const hit = document.elementFromPoint(x, y);
                      return {x, y, input: hit === element || element.contains(hit),
                        target: hit ? hit.tagName + '#' + hit.id + '.' + hit.className : null};
                    })) : [];
                const host = window.__INHERITANCE_TEST_HOST__;
                const hostState = host ? {
                  history: host.history.map(({id, command, state, response}) => ({id, command, state, errorCode: response?.error_code})),
                  pending: host.pending.map(({id, command, state}) => ({id, command, state})),
                  dialogOpen: document.querySelector('#inheritance-test-controls')?.shadowRoot?.querySelector('dialog')?.open,
                } : null;
                const metrics = {innerHeight, innerWidth, scrollY, interactionTrace, authTrace, hostState,
                  telemetryState: 'ok', telemetryErrors,
                  doneRect: doneRect ? [doneRect.x, doneRect.y, doneRect.width, doneRect.height] : null,
                  intervalRect: intervalRect ? [intervalRect.x, intervalRect.y, intervalRect.width, intervalRect.height] : null,
                  actionsHidden: hidden('.plan-primary-actions'),
                  navigationHidden: hidden('.tab-bar'),
                  inputUnobscured: hits.length === 9 && hits.every(hit => hit.input),
                  inputHitTargets: hits,
                  viewport: viewport ? {height: viewport.height, width: viewport.width,
                    offsetTop: viewport.offsetTop, pageTop: viewport.pageTop, scale: viewport.scale} : null,
                  input: rect && element?.matches('input,textarea') ? {top: rect.top,
                    bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height,
                    width: rect.width, id: element.id} : null,
                  keyboard: document.documentElement.dataset.planKeyboard ?? null};
                const serialized = JSON.stringify(metrics);
                if (serialized !== previous) {
                  // Send only the plain values we serialized, never DOM wrappers.
                  window.webkit.messageHandlers.viewportMetrics.postMessage(JSON.parse(serialized));
                  previous = serialized;
                }
              };
              const report = () => {
                try {
                  sample();
                } catch (error) {
                  telemetryErrors.push({message: String(error?.message || error), at: Math.round(performance.now())});
                  if (telemetryErrors.length > 8) telemetryErrors.shift();
                  try {
                    // Invalidate geometry rather than passing a stale sample as current.
                    window.webkit.messageHandlers.viewportMetrics.postMessage({telemetryState: 'error', telemetryErrors});
                  } catch {
                    console.error('TEST HOST viewport telemetry unavailable', telemetryErrors.at(-1));
                  }
                } finally {
                  // A transient reporter/bridge error must not stop all future samples.
                  requestAnimationFrame(report);
                }
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
        toolbar = UIStackView(arrangedSubviews: [address, open, reload])
        toolbar.spacing = 8
        let hostViews: [UIView] = [status, toolbar, webView!]
        hostViews.forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview($0)
        }
        webBottom = webView.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)
        toolbarHeight = toolbar.heightAnchor.constraint(equalToConstant: 44)
        NSLayoutConstraint.activate([
            status.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 4),
            status.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            status.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
            toolbar.topAnchor.constraint(equalTo: status.bottomAnchor, constant: 4),
            toolbar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 8),
            toolbar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -8),
            toolbarHeight,
            open.widthAnchor.constraint(equalToConstant: 48),
            reload.widthAnchor.constraint(equalToConstant: 44),
            webView.topAnchor.constraint(equalTo: toolbar.bottomAnchor, constant: 4),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            // The layout guide can omit WKWebView's accessory toolbar. Its
            // measured public inputAccessoryView supplies any extra clearance.
            webBottom
        ])
        for name in [UIResponder.keyboardWillChangeFrameNotification,
                     UIResponder.keyboardDidChangeFrameNotification,
                     UIResponder.keyboardDidHideNotification] {
            NotificationCenter.default.addObserver(self, selector: #selector(keyboardFrameChanged(_:)), name: name, object: nil)
        }
        openTestURL()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        updateKeyboardClearance()
        updateViewportTrace()
    }

    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        coordinator.animate(alongsideTransition: nil) { [weak self] _ in
            self?.view.setNeedsLayout()
        }
    }

    @objc private func keyboardFrameChanged(_ notification: Notification) {
        keyboardScreenFrame = notification.name == UIResponder.keyboardDidHideNotification ? nil
            : (notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue
        view.setNeedsLayout()
    }

    private func firstResponder(in parent: UIView) -> UIView? {
        if parent.isFirstResponder { return parent }
        for child in parent.subviews {
            if let responder = firstResponder(in: child) { return responder }
        }
        return nil
    }

    private func accessoryFrame() -> CGRect? {
        guard let window = view.window,
              let accessory = firstResponder(in: webView)?.inputAccessoryView,
              !accessory.isHidden, accessory.alpha > 0, !accessory.bounds.isEmpty,
              let accessoryWindow = accessory.window else { return nil }
        let inAccessoryWindow = accessory.convert(accessory.bounds, to: accessoryWindow)
        let inWindow = window.convert(inAccessoryWindow, from: accessoryWindow)
        return view.convert(inWindow, from: window)
    }

    private func updateKeyboardClearance() {
        guard webBottom != nil, let window = view.window else { return }
        // Debug URL controls must not consume the input's remaining landscape
        // space above the system keyboard and WKWebView accessory bars.
        let compact = view.bounds.width > view.bounds.height && view.bounds.height < 500
        let height: CGFloat = compact ? 0 : 44
        if toolbarHeight.constant != height {
            toolbar.isHidden = compact
            toolbarHeight.constant = height
        }
        let guideTop = view.keyboardLayoutGuide.layoutFrame.minY
        var visibleBottom = guideTop
        var obstructions: [CGRect] = []
        if let frame = keyboardScreenFrame {
            // Keyboard notifications use screen coordinates; account for the
            // app window before comparing them with this view's layout guide.
            obstructions.append(view.convert(window.convert(frame, from: nil), from: window))
        }
        if let frame = accessoryFrame() { obstructions.append(frame) }
        for obstruction in obstructions {
            let overlap = view.bounds.intersection(obstruction)
            if !overlap.isNull && !overlap.isEmpty && overlap.minY >= webView.frame.minY {
                visibleBottom = min(visibleBottom, overlap.minY)
            }
        }
        let clearance = min(0, visibleBottom - guideTop)
        if abs(webBottom.constant - clearance) > 0.5 {
            webBottom.constant = clearance
            view.setNeedsLayout()
        }
    }

    func recordWindowTouches(_ event: UIEvent) {
        guard traceWindowTouches, event.type == .touches, let webView = webView,
              let touches = event.allTouches else { return }
        for touch in touches {
            let point = touch.location(in: webView)
            guard webView.bounds.contains(point) else { continue }
            let phase: String
            switch touch.phase {
            case .began: phase = "began"
            case .moved: phase = "moved"
            case .ended: phase = "ended"
            case .cancelled: phase = "cancelled"
            default: continue
            }
            windowTouchTrace.append([
                "phase": phase, "at": touch.timestamp,
                "x": point.x, "y": point.y,
                "recognizers": (touch.gestureRecognizers ?? []).map {
                    ["type": String(describing: type(of: $0)), "state": $0.state.rawValue] as [String: Any]
                }
            ])
            if windowTouchTrace.count > 32 { windowTouchTrace.removeFirst() }
            if touch.phase == .ended || touch.phase == .cancelled {
                // Publish even when WebKit emits no DOM event for this touch.
                DispatchQueue.main.async { [weak self] in self?.updateViewportTrace() }
            }
        }
    }

    private func updateViewportTrace() {
        guard var metrics = lastViewportMetrics, let webView = webView else { return }
        let frame = webView.convert(webView.bounds, to: view.window)
        metrics["nativeCommands"] = commandTrace
        if traceWindowTouches { metrics["windowTouches"] = windowTouchTrace }
        metrics["nativeWebView"] = [frame.minX, frame.minY, frame.width, frame.height]
        let keyboardFrame = view.keyboardLayoutGuide.layoutFrame
        metrics["keyboardGuide"] = [keyboardFrame.minX, keyboardFrame.minY, keyboardFrame.width, keyboardFrame.height]
        if let accessory = accessoryFrame() {
            metrics["accessoryFrame"] = [accessory.minX, accessory.minY, accessory.width, accessory.height]
        }
        metrics["accessoryClearance"] = -(webBottom?.constant ?? 0)
        if let data = try? JSONSerialization.data(withJSONObject: metrics, options: [.sortedKeys]),
           let value = String(data: data, encoding: .utf8), status.accessibilityValue != value {
            status.accessibilityValue = value
        }
    }

    @objc private func openTestURL() {
        guard let url = URL(string: address.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""),
              Self.isLocalTestURL(url) else {
            status.text = "Use http(s)://localhost or a private LAN IPv4 address"
            return
        }
        allowedURL = url
        traceWindowTouches = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
            .contains { $0.name == "touchTrace" && $0.value == "1" } == true
        windowTouchTrace.removeAll()
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
                  sameOrigin(webView.url), let metrics = message.body as? [String: Any] else { return }
            lastViewportMetrics = metrics
            updateViewportTrace()
            return
        }
        if message.name == "minikit" {
            let body = message.body as? [String: Any]
            let command = body?["command"] as? String ?? "invalid"
            let names = ["init", "wallet-auth", "send-transaction", "get-permissions", "request-permission", "share-contacts", "chat"]
            commandTrace.append([
                "command": names.contains(command) ? command : "unknown",
                "mainFrame": message.frameInfo.isMainFrame,
                "originAccepted": sameOrigin(message.frameInfo.request.url) && sameOrigin(webView.url),
                "at": ProcessInfo.processInfo.systemUptime
            ])
            if commandTrace.count > 40 { commandTrace.removeFirst() }
            updateViewportTrace()
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

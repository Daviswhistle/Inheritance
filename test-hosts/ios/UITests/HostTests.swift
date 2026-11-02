import XCTest

final class HostTests: XCTestCase {
    override func setUp() {
        super.setUp()
        XCUIDevice.shared.orientation = .portrait
    }

    override func tearDown() {
        if (testRun?.failureCount ?? 0) > 0 {
            let app = XCUIApplication()
            print("FAILURE VIEWPORT: \(app.staticTexts["test-host-status"].value ?? "missing")")
            capture("failure-screen", app)
            print(app.debugDescription)
        }
        XCUIDevice.shared.orientation = .portrait
        super.tearDown()
    }

    func testRealSDKLoginAndNativeLifecycle() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US",
                               "-testURL", "http://localhost:7777/?platform=ios&approval=manual&trace=1&residence=KR"]
        app.launch()
        let initialPortrait = NSPredicate { _, _ in app.frame.height > app.frame.width }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: initialPortrait, object: nil)], timeout: 20), .completed)
        defer { XCUIDevice.shared.orientation = .portrait }
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 60))
        XCTAssertTrue(web.buttons["Home"].firstMatch.waitForExistence(timeout: 120), "Wait for initial JS bootstrap, not merely the WKWebView container\n\(app.debugDescription)")
        for label in ["Assets", "Help", "Home", "Plan"] {
            let tab = web.buttons[label].firstMatch
            XCTAssertTrue(tab.waitForExistence(timeout: 30), "Missing tab: \(label)\n\(app.debugDescription)")
            tab.tap()
        }
        let login = web.buttons["Agree and sign in"].firstMatch
        XCTAssertTrue(login.waitForExistence(timeout: 20))
        login.tap()
        let reject = web.buttons["Reject"].firstMatch
        XCTAssertTrue(reject.waitForExistence(timeout: 20))
        reject.press(forDuration: 0.15)
        let canRetry = NSPredicate { _, _ in login.exists && login.isEnabled }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: canRetry, object: nil)], timeout: 20), .completed)
        login.tap()
        XCTAssertTrue(reject.waitForExistence(timeout: 20))
        capture("approval-pending-before-termination", app)
        app.terminate()
        app.launch()
        // A pending host approval must not silently authenticate after process death.
        XCTAssertTrue(login.waitForExistence(timeout: 120))
        XCTAssertFalse(web.textFields["USDC"].firstMatch.exists)
        login.tap()
        let approve = web.buttons["Approve"].firstMatch
        XCTAssertTrue(approve.waitForExistence(timeout: 20))
        approve.tap()
        let recipient = web.textFields.matching(NSPredicate(format: "label CONTAINS %@ OR placeholderValue == %@", "Who should receive", "@username or wallet address")).firstMatch
        XCTAssertTrue(recipient.waitForExistence(timeout: 60), "SDK login must reveal the setup form\n\(app.debugDescription)")
        let amount = web.textFields["USDC"].firstMatch
        XCTAssertTrue(amount.waitForExistence(timeout: 10))
        scrollInputAboveFixedFooter(amount, in: web, app: app)
        amount.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        waitForStableControl(amount, in: web)
        amount.typeText("12.345678")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in amount.value as? String == "12.345678" }, object: nil)], timeout: 10), .completed)
        capture("decimal-keyboard", app)
        dismissKeyboard(in: web, app: app)
        XCTAssertTrue(web.buttons["Review plan"].waitForExistence(timeout: 10))
        // WKWebView's accessibility tree includes offscreen inputs. Bring the
        // recipient above the fixed actions before tapping; do not type through
        // a still-visible decimal keyboard using stale element coordinates.
        scrollInputAboveFixedFooter(recipient, in: web, app: app)
        XCTAssertTrue(recipient.isHittable)
        recipient.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        waitForStableControl(recipient, in: web)
        recipient.typeText("@test_heir")
        // Use the host's actual fixture identity. An unresolved name inserts
        // an error row that, with longer help text, puts the target label below
        // the minimum scroll position allowed by input-clearance protection.
        XCTAssertTrue(web.staticTexts["@test_heir"].firstMatch.waitForExistence(timeout: 30),
                      "Wait for the configured recipient to resolve before arranging overlap")
        XCTAssertFalse(web.buttons["Review plan"].exists, "Fixed review action must not cover keyboard input")
        // Accessibility can inflate a 48 CSS-pixel input to 49.05 native points.
        // Round the baseline to pixels before applying the one-pixel tolerance.
        let fullInputHeight = max(44, recipient.frame.height.rounded(.down))
        assertVisibleInput(recipient, in: web, app: app, height: fullInputHeight,
                           text: "@test_heir", screenshot: "native-keyboard")
        XCUIDevice.shared.orientation = .landscapeLeft
        let landscape = NSPredicate { _, _ in app.frame.width > app.frame.height }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: landscape, object: nil)], timeout: 10), .completed)
        XCTAssertEqual(recipient.value as? String, "@test_heir")
        assertVisibleInput(recipient, in: web, app: app, height: fullInputHeight,
                           text: "@test_heir", screenshot: "landscape-input-preserved")
        XCUIDevice.shared.orientation = .portrait
        let portrait = NSPredicate { _, _ in app.frame.height > app.frame.width }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: portrait, object: nil)], timeout: 10), .completed)
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(recipient.waitForExistence(timeout: 15))
        XCTAssertEqual(recipient.value as? String, "@test_heir")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in amount.value as? String == "12.345678" }, object: nil)], timeout: 10), .completed)
        assertVisibleInput(recipient, in: web, app: app, height: fullInputHeight,
                           text: "@test_heir", screenshot: "foreground-input-preserved")
        alignIntervalLabelBehindDone(in: web, app: app)
        dismissKeyboard(in: web, app: app)
        XCTAssertTrue(web.buttons["Review plan"].waitForExistence(timeout: 10), "Dismissal restores review action")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in amount.value as? String == "12.345678" }, object: nil)], timeout: 10), .completed)
        capture("keyboard-dismissed-actions-restored", app)
        // Repeat the same native foreground/dismissal path: a prior run moved
        // focus to the period field after Done despite a passing next run.
        for cycle in 1...3 {
            scrollInputAboveFixedFooter(recipient, in: web, app: app)
            recipient.tap()
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
            waitForStableControl(recipient, in: web)
            XCUIDevice.shared.orientation = .landscapeLeft
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: landscape, object: nil)], timeout: 10), .completed)
            assertVisibleInput(recipient, in: web, app: app, height: fullInputHeight,
                               text: "@test_heir", screenshot: "repeat-landscape-\(cycle)")
            XCUIDevice.shared.orientation = .portrait
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: portrait, object: nil)], timeout: 10), .completed)
            XCUIDevice.shared.press(.home)
            app.activate()
            assertVisibleInput(recipient, in: web, app: app, height: fullInputHeight,
                               text: "@test_heir", screenshot: "repeat-foreground-\(cycle)")
            alignIntervalLabelBehindDone(in: web, app: app)
            dismissKeyboard(in: web, app: app)
            XCTAssertTrue(web.buttons["Review plan"].waitForExistence(timeout: 10),
                          "Repeated foreground dismissal must restore actions (cycle \(cycle))")
            XCTAssertEqual(recipient.value as? String, "@test_heir")
        }
    }

    func testZPendingDepositSurvivesProcessTermination() throws {
        continueAfterFailure = false
        let config = try hostJSON("/__host/config")
        let account = try XCTUnwrap(config["heir"] as? String)
        let recipientAddress = try XCTUnwrap(config["owner"] as? String)
        let factory = try XCTUnwrap(config["usdcFactory"] as? String)
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US",
                               "-testURL", "http://localhost:7777/?platform=ios&account=heir&approval=auto&residence=KR"]
        app.launch()
        let initialPortrait = NSPredicate { _, _ in app.frame.height > app.frame.width }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: initialPortrait, object: nil)], timeout: 20), .completed)
        defer {
            _ = try? hostJSON("/__host/control", body: ["action": "mining", "enabled": true])
            app.terminate()
        }
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.buttons["Plan"].firstMatch.waitForExistence(timeout: 120))
        web.buttons["Plan"].firstMatch.tap()
        let login = web.buttons["Agree and sign in"].firstMatch
        XCTAssertTrue(login.waitForExistence(timeout: 30))
        login.tap()
        let amount = web.textFields["USDC"].firstMatch
        XCTAssertTrue(amount.waitForExistence(timeout: 60))
        scrollInputAboveFixedFooter(amount, in: web, app: app)
        amount.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        waitForStableControl(amount, in: web)
        amount.typeText("1.000001")
        dismissKeyboard(in: web, app: app)
        let recipient = web.textFields.matching(NSPredicate(format: "label CONTAINS %@ OR placeholderValue == %@", "Who should receive", "@username or wallet address")).firstMatch
        scrollInputAboveFixedFooter(recipient, in: web, app: app)
        recipient.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        waitForStableControl(recipient, in: web)
        recipient.typeText(recipientAddress)
        dismissKeyboard(in: web, app: app)
        let review = web.buttons["Review plan"].firstMatch
        let ready = NSPredicate { _, _ in review.exists && review.isEnabled }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: nil)], timeout: 30), .completed)
        review.tap()
        let consent = web.staticTexts["I have reviewed the fees and understand the loss, liquidity and unaudited-contract risks."].firstMatch
        XCTAssertTrue(consent.waitForExistence(timeout: 20))
        for _ in 0..<6 {
            if consent.isHittable && consent.frame.maxY < app.frame.maxY - 150 { break }
            web.swipeUp()
        }
        consent.tap()
        let confirm = web.buttons["Open approval screen"].firstMatch
        XCTAssertTrue(confirm.isEnabled)
        let nonceBefore = try rpcString("eth_getTransactionCount", [account, "latest"])
        _ = try hostJSON("/__host/control", body: ["action": "mining", "enabled": false])
        confirm.tap()
        // This state is rendered only after the SDK operation ID is saved.
        XCTAssertTrue(web.staticTexts["Verifying transaction"].firstMatch.waitForExistence(timeout: 30))
        let pendingNonce = try rpcString("eth_getTransactionCount", [account, "pending"])
        XCTAssertNotEqual(pendingNonce, nonceBefore)
        XCTAssertEqual(try rpcString("eth_getTransactionCount", [account, "latest"]), nonceBefore)
        capture("transaction-pending-before-process-death", app)
        app.terminate()
        app.launch()
        XCTAssertTrue(web.buttons["Plan"].firstMatch.waitForExistence(timeout: 120))
        web.buttons["Plan"].firstMatch.tap()
        XCTAssertTrue(login.waitForExistence(timeout: 30))
        login.tap()
        let saved = web.staticTexts["Continue unfinished setup"].firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 60), "Unconfirmed setup must survive native process death")
        XCTAssertEqual(try rpcString("eth_getTransactionCount", [account, "pending"]), pendingNonce, "Restart must not submit another transaction")
        _ = try hostJSON("/__host/control", body: ["action": "mine"])
        // Mining the first EIP-7702 delegation consumes an authorization nonce
        // as well as the outer transaction nonce. Compare recovery against the
        // mined baseline, not Anvil's pre-execution pending nonce estimate.
        let minedNonce = try rpcString("eth_getTransactionCount", [account, "latest"])
        XCTAssertNotEqual(minedNonce, nonceBefore)
        let resume = web.buttons["Resume remaining setup"].firstMatch
        XCTAssertTrue(resume.waitForExistence(timeout: 20))
        for _ in 0..<5 {
            if resume.isHittable { break }
            web.swipeUp()
        }
        XCTAssertTrue(resume.isEnabled)
        resume.tap()
        let recovered = NSPredicate { _, _ in !saved.exists }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: recovered, object: nil)], timeout: 60), .completed)
        let encodedOwner = String(repeating: "0", count: 24) + String(account.dropFirst(2))
        let encodedVault = try rpcString("eth_call", [["to": factory, "data": "0x0709df45" + encodedOwner], "latest"])
        let vault = "0x" + String(encodedVault.suffix(40))
        XCTAssertNotEqual(vault, "0x" + String(repeating: "0", count: 40))
        let basis = try rpcString("eth_call", [["to": vault, "data": "0x53e3cb5f"], "latest"])
        XCTAssertEqual(UInt64(basis.dropFirst(2), radix: 16), 1_000_001)
        // Removing the recovery panel alone does not prove that Home has loaded
        // the recovered position. Wait for the actual balance and active plan.
        // formatYieldAmount preserves all six USDC decimal places for this value.
        let displayedBalance = web.staticTexts["1.000001"].firstMatch
        let checkIn = web.buttons["Check in"].firstMatch
        let emptyHome = web.staticTexts["No assets saved for inheritance"].firstMatch
        let settledHome = NSPredicate { _, _ in
            web.staticTexts["Your inheritance savings"].firstMatch.exists
                && web.staticTexts["USDC"].firstMatch.exists
                && displayedBalance.exists
                && web.staticTexts["Next check-in"].firstMatch.exists
                && checkIn.exists && checkIn.isEnabled
                && !web.staticTexts["Updating…"].firstMatch.exists
                && !web.staticTexts["Checking status…"].firstMatch.exists
                && !emptyHome.exists
        }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: settledHome, object: nil)], timeout: 60), .completed,
                       "Recovery must render the funded USDC position and an active check-in, not a loading or empty Home")
        for _ in 0..<4 {
            if displayedBalance.isHittable && displayedBalance.frame.maxY <= web.frame.maxY - 80 { break }
            web.swipeUp()
        }
        XCTAssertTrue(displayedBalance.isHittable, "The verified balance must be visible in the recovery screenshot")
        XCTAssertFalse(emptyHome.exists)
        XCTAssertEqual(try rpcString("eth_getTransactionCount", [account, "latest"]), minedNonce)
        XCTAssertEqual(try rpcString("eth_getTransactionCount", [account, "pending"]), minedNonce, "Recovery must not replay an already submitted deposit")
        capture("pending-deposit-recovered-without-resubmission", app)
    }

    private func dismissKeyboard(in web: XCUIElement, app: XCUIApplication) {
        let done = web.buttons["Done"].firstMatch
        waitForStableControl(done, in: web, timeout: 60)
        done.tap()
        if app.launchArguments.contains(where: { $0.contains("trace=1") }) {
            let closed = NSPredicate { _, _ in !app.keyboards.firstMatch.exists }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: closed, object: nil)], timeout: 10), .completed,
                           "Done must dismiss the keyboard without focusing another field")
            guard let raw = app.staticTexts["test-host-status"].value as? String,
                  let data = raw.data(using: .utf8),
                  let metrics = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let trace = metrics["interactionTrace"] as? [[String: Any]],
                  let start = trace.lastIndex(where: { $0["type"] as? String == "pointerdown" }) else {
                XCTFail("Done must have a native gesture trace"); return
            }
            let gesture = trace[start...]
            XCTAssertTrue((trace[start]["target"] as? String)?.contains("plan-keyboard-done") == true,
                          "The original touch must land on Done")
            XCTAssertTrue(gesture.contains { $0["type"] as? String == "touchend" && $0["prevented"] as? Bool == true },
                          "Consume the compatibility click before native keyboard reflow")
            XCTAssertFalse(gesture.contains { $0["type"] as? String == "click" },
                           "A Done touch must not generate a second click on underlying content: \(gesture)")
        }
        print("AFTER DONE: \(app.staticTexts["test-host-status"].value ?? "missing")")
    }

    private func alignIntervalLabelBehindDone(in web: XCUIElement, app: XCUIApplication) {
        // The reported failure had the fixed Done button over this label. A tap
        // must not activate that label when keyboard dismissal changes layout.
        let done = web.buttons["Done"].firstMatch
        waitForStableControl(done, in: web, timeout: 60)
        func geometry() -> (button: [Double], interval: [Double])? {
            guard let raw = app.staticTexts["test-host-status"].value as? String,
                  let data = raw.data(using: .utf8),
                  let metrics = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let button = metrics["doneRect"] as? [Double], button.count == 4,
                  let interval = metrics["intervalRect"] as? [Double], interval.count == 4,
                  button[2] > 0, button[3] > 0, interval[3] > 0 else { return nil }
            return (button, interval)
        }
        var panAllowance = 20.0
        for attempt in 0..<12 {
            guard let before = geometry() else { XCTFail("Missing overlap geometry"); return }
            let x = before.button[0] + before.button[2] / 2
            let y = before.button[1] + before.button[3] / 2
            if x >= before.interval[0] && x <= before.interval[0] + before.interval[2]
                && y >= before.interval[1] && y <= before.interval[1] + before.interval[3] { break }
            let delta = before.interval[1] + before.interval[3] / 2 - y
            let origin = web.coordinate(withNormalizedOffset: .zero)
            let start = web.frame.height * 0.5
            // Short drags can be entirely consumed by UIKit pan recognition.
            // Measure actual DOM movement, not the possibly clipped AX label,
            // and adapt the next gesture while preserving the exact overlap gate.
            let distance = min(120, abs(delta) + panAllowance)
            let step = delta < 0 ? -distance : distance
            // Release only after the finger has stopped. Default fast drags
            // can fling past the target while keyboard/input reflow pulls back,
            // making the measured correction alternate in opposite directions.
            origin.withOffset(CGVector(dx: 8, dy: start))
                .press(forDuration: 0.05,
                       thenDragTo: origin.withOffset(CGVector(dx: 8, dy: start - step)),
                       withVelocity: .slow, thenHoldForDuration: 0.5)
            var previous: [Double] = []
            var stableSince = Date()
            let settled = NSPredicate { _, _ in
                guard let value = geometry() else { return false }
                let current = value.button + value.interval
                if current != previous { previous = current; stableSince = Date(); return false }
                return Date().timeIntervalSince(stableSince) >= 0.5
            }
            XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: settled, object: nil)], timeout: 5), .completed,
                           "Wait for the native pan and input-clearance reflow to settle")
            guard let after = geometry() else { XCTFail("Missing settled overlap geometry"); return }
            let moved = (before.interval[1] - after.interval[1]) * (delta < 0 ? -1 : 1)
            print("OVERLAP ALIGN \(attempt): before=\(before.interval) button=\(before.button) step=\(step) after=\(after.interval) moved=\(moved)")
            panAllowance = moved > 1 ? min(80, max(12, distance - moved)) : min(80, panAllowance + 16)
        }
        let overlapping = NSPredicate { _, _ in
            guard let raw = app.staticTexts["test-host-status"].value as? String,
                  let data = raw.data(using: .utf8),
                  let metrics = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let button = metrics["doneRect"] as? [Double], button.count == 4,
                  let interval = metrics["intervalRect"] as? [Double], interval.count == 4 else { return false }
            let x = button[0] + button[2] / 2, y = button[1] + button[3] / 2
            return button[2] > 0 && button[3] > 0 && x >= interval[0] && x <= interval[0] + interval[2]
                && y >= interval[1] && y <= interval[1] + interval[3]
        }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: overlapping, object: nil)], timeout: 10), .completed,
                       "Reproduce the original overlap geometry before tapping Done")
        capture("done-over-interval-label", app)
    }

    private func waitForStableControl(_ control: XCUIElement, in web: XCUIElement, timeout: TimeInterval = 20) {
        var previous = CGRect.zero
        var stableSince: Date?
        var observations = 0
        let stable = NSPredicate { _, _ in
            guard control.exists && control.isHittable else {
                stableSince = nil; observations = 0; return false
            }
            let frame = control.frame
            let webFrame = web.frame
            print("CONTROL STABILITY: frame=\(frame) web=\(webFrame) observations=\(observations)")
            guard frame.height >= 44, frame.minY >= webFrame.minY,
                  frame.maxY <= webFrame.maxY else {
                stableSince = nil; observations = 0; return false
            }
            if frame != previous || stableSince == nil {
                previous = frame; stableSince = Date(); observations = 1; return false
            }
            observations += 1
            return observations >= 3 && Date().timeIntervalSince(stableSince ?? Date()) >= 0.8
        }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: stable, object: nil)], timeout: timeout), .completed,
                       "Wait for the visible web control to settle before interacting")
    }

    private func scrollInputAboveFixedFooter(_ input: XCUIElement, in web: XCUIElement,
                                             app: XCUIApplication) {
        for _ in 0..<4 {
            if input.exists && input.isHittable && input.frame.minY > web.frame.minY + 20
                && input.frame.maxY < app.frame.maxY - 180 { break }
            // A full WebView swipe can jump past the field on short devices.
            // Start inside the content above the fixed review/nav controls.
            let contentHeight = min(web.frame.height, app.frame.maxY - 180 - web.frame.minY)
            let origin = web.coordinate(withNormalizedOffset: .zero)
            let startY = contentHeight * 0.75
            let step = contentHeight * 0.3
            let above = input.exists && input.frame.minY <= web.frame.minY + 20
            let endY = above ? startY + step : startY - step
            origin.withOffset(CGVector(dx: web.frame.width / 2, dy: startY))
                .press(forDuration: 0.05, thenDragTo:
                    origin.withOffset(CGVector(dx: web.frame.width / 2, dy: endY)))
        }
        XCTAssertTrue(input.isHittable, "Amount field must be hittable after native scrolling\n\(app.debugDescription)")
        XCTAssertGreaterThan(input.frame.minY, web.frame.minY + 20, "Amount field must be inside the WebView viewport")
        XCTAssertLessThan(input.frame.maxY, app.frame.maxY - 180, "Amount field must clear the fixed footer")
    }

    private func assertVisibleInput(_ input: XCUIElement, in web: XCUIElement,
                                    app: XCUIApplication, height: CGFloat,
                                    text: String, screenshot name: String) {
        let inputLabel = input.label
        var lastGeometry = ""
        var stableSince: Date?
        var observations = 0
        var lastInvalidGeometry = ""
        let status = app.staticTexts["test-host-status"]
        let keyboard = app.keyboards.firstMatch
        let visibleAndStable = NSPredicate { _, _ in
            // Snapshot values are truncated at 512 characters by XCTest. Read
            // the complete telemetry directly, then take one coherent snapshot
            // for app frames. All values must agree across stable samples.
            let raw = status.value as? String ?? ""
            // A keyboard inside app.snapshot() retains portrait coordinates
            // after rotation. The direct element frame is screen-oriented.
            let keyboardFrame = keyboard.frame
            guard let snapshot = try? app.snapshot() else {
                stableSince = nil; observations = 0; return false
            }
            let nodes = self.flattenedSnapshots(snapshot)
            guard let inputSnapshot = nodes.first(where: { $0.elementType == .textField && $0.label == inputLabel }),
                  let webSnapshot = nodes.first(where: { $0.elementType == .webView && !$0.frame.isEmpty }),
                  let doneSnapshot = nodes.first(where: { $0.elementType == .button && $0.label == "Done" && !$0.frame.isEmpty }),
                  !keyboardFrame.isEmpty else {
                stableSince = nil; observations = 0; return false
            }
            let field = inputSnapshot.frame
            let webFrame = webSnapshot.frame
            let doneFrame = doneSnapshot.frame
            guard let data = raw.data(using: .utf8),
                  let metrics = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  let rect = metrics["input"] as? [String: Any],
                  let viewport = metrics["viewport"] as? [String: Any],
                  let native = metrics["nativeWebView"] as? [Double], native.count == 4,
                  let cssTop = rect["top"] as? Double, let cssBottom = rect["bottom"] as? Double,
                  let cssHeight = rect["height"] as? Double,
                  let offset = viewport["offsetTop"] as? Double,
                  let visibleHeight = viewport["height"] as? Double,
                  let scale = viewport["scale"] as? Double else {
                if raw != lastInvalidGeometry { print("INPUT METRICS NOT READY \(name): \(raw)"); lastInvalidGeometry = raw }
                stableSince = nil; observations = 0; return false
            }
            let occlusion = min(min(keyboardFrame.minY, doneFrame.minY), webFrame.maxY)
            // Both full CSS geometry and native geometry must fit. A clipped
            // accessibility rectangle with only the top border is not a pass.
            let fullTop = CGFloat(native[1] + (cssTop - offset) * scale)
            let fullBottom = CGFloat(native[1] + (cssBottom - offset) * scale)
            let editingControlsHidden = metrics["keyboard"] is String
                && (metrics["actionsHidden"] as? Bool == true)
                && (metrics["navigationHidden"] as? Bool == true)
            let valid = editingControlsHidden && (metrics["inputUnobscured"] as? Bool == true)
                && (inputSnapshot.value as? String == text)
                && field.height >= height - 1
                && cssHeight >= Double(height - 1) && field.minY >= webFrame.minY
                && field.maxY <= occlusion && fullTop >= webFrame.minY
                && fullBottom <= occlusion && cssTop >= offset
                && cssBottom <= offset + visibleHeight
            let geometry = "\(field)|\(webFrame)|\(keyboardFrame)|\(doneFrame)|\(raw)"
            guard valid else {
                if geometry != lastInvalidGeometry { print("INPUT GEOMETRY INVALID \(name): \(geometry)"); lastInvalidGeometry = geometry }
                stableSince = nil; observations = 0; return false
            }
            if geometry != lastGeometry || stableSince == nil {
                lastGeometry = geometry; stableSince = Date(); observations = 1; return false
            }
            observations += 1
            return observations >= 3 && Date().timeIntervalSince(stableSince ?? Date()) >= 0.8
        }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: visibleAndStable, object: nil)], timeout: 30), .completed,
                       "Entire input must remain visible after native and DOM geometry settle")
        XCTAssertTrue(input.isHittable, "The geometrically verified input must remain hittable")
        print("INPUT GEOMETRY \(name): \(app.staticTexts["test-host-status"].value ?? "missing")")
        XCTAssertFalse(web.buttons["Review plan"].exists, "Review actions must remain hidden during every keyboard phase")
        for label in ["Home", "Assets", "Plan", "Help"] {
            XCTAssertFalse(web.buttons[label].exists, "Tab navigation must not cover the focused input: " + label)
        }
        capture(name, app)
        XCTAssertTrue(visibleAndStable.evaluate(with: nil), "Input geometry must stay valid through screenshot capture")
        print("INPUT GEOMETRY AFTER \(name): \(app.staticTexts["test-host-status"].value ?? "missing")")
    }

    private func flattenedSnapshots(_ root: any XCUIElementSnapshot) -> [any XCUIElementSnapshot] {
        var result: [any XCUIElementSnapshot] = [root]
        for child in root.children { result.append(contentsOf: flattenedSnapshots(child)) }
        return result
    }

    private func hostJSON(_ path: String, body: [String: Any]? = nil) throws -> [String: Any] {
        var request = URLRequest(url: URL(string: "http://localhost:7777" + path)!)
        request.timeoutInterval = 10
        if let body = body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let completed = expectation(description: "Local host " + path)
        var result: Result<[String: Any], Error>?
        URLSession.shared.dataTask(with: request) { data, response, error in
            defer { completed.fulfill() }
            do {
                if let error = error { throw error }
                guard (response as? HTTPURLResponse)?.statusCode == 200, let data = data,
                      let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    throw NSError(domain: "InheritanceTestHost", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid local host response for " + path])
                }
                result = .success(object)
            } catch { result = .failure(error) }
        }.resume()
        XCTAssertEqual(XCTWaiter.wait(for: [completed], timeout: 15), .completed)
        return try XCTUnwrap(result).get()
    }

    private func rpcString(_ method: String, _ params: [Any]) throws -> String {
        let response = try hostJSON("/__host/rpc", body: ["jsonrpc": "2.0", "id": 1, "method": method, "params": params])
        XCTAssertNil(response["error"], "Local RPC failed: \(response)")
        return try XCTUnwrap(response["result"] as? String)
    }

    @discardableResult
    private func capture(_ name: String, _ app: XCUIApplication) -> XCUIScreenshot {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        return screenshot
    }
}

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
                               "-testURL", "http://localhost:7777/?platform=ios&approval=manual&trace=1"]
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
        amount.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        amount.typeText("12.345678")
        XCTAssertEqual(amount.value as? String, "12.345678")
        capture("decimal-keyboard", app)
        app.buttons["Done"].firstMatch.tap()
        XCTAssertTrue(web.buttons["Review plan"].waitForExistence(timeout: 10))
        // WKWebView's accessibility tree includes offscreen inputs. Bring the
        // recipient above the fixed actions before tapping; do not type through
        // a still-visible decimal keyboard using stale element coordinates.
        for _ in 0..<4 {
            if recipient.frame.maxY < app.frame.maxY - 180 && recipient.frame.minY > web.frame.minY + 20 { break }
            web.swipeUp()
        }
        XCTAssertTrue(recipient.isHittable)
        recipient.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        recipient.typeText("@sam")
        XCTAssertFalse(web.buttons["Review plan"].exists, "Fixed review action must not cover keyboard input")
        let fullInputHeight = max(44, recipient.frame.height)
        assertVisibleInput(recipient, in: web, app: app, height: fullInputHeight,
                           text: "@sam", screenshot: "native-keyboard")
        XCUIDevice.shared.orientation = .landscapeLeft
        let landscape = NSPredicate { _, _ in app.frame.width > app.frame.height }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: landscape, object: nil)], timeout: 10), .completed)
        XCTAssertEqual(recipient.value as? String, "@sam")
        assertVisibleInput(recipient, in: web, app: app, height: fullInputHeight,
                           text: "@sam", screenshot: "landscape-input-preserved")
        XCUIDevice.shared.orientation = .portrait
        let portrait = NSPredicate { _, _ in app.frame.height > app.frame.width }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: portrait, object: nil)], timeout: 10), .completed)
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(recipient.waitForExistence(timeout: 15))
        XCTAssertEqual(recipient.value as? String, "@sam")
        XCTAssertEqual(amount.value as? String, "12.345678")
        assertVisibleInput(recipient, in: web, app: app, height: fullInputHeight,
                           text: "@sam", screenshot: "foreground-input-preserved")
        app.buttons["Done"].firstMatch.tap()
        XCTAssertTrue(web.buttons["Review plan"].waitForExistence(timeout: 10), "Dismissal restores review action")
        XCTAssertEqual(amount.value as? String, "12.345678")
        capture("keyboard-dismissed-actions-restored", app)
    }

    func testZPendingDepositSurvivesProcessTermination() throws {
        continueAfterFailure = false
        let config = try hostJSON("/__host/config")
        let account = try XCTUnwrap(config["heir"] as? String)
        let recipientAddress = try XCTUnwrap(config["owner"] as? String)
        let factory = try XCTUnwrap(config["usdcFactory"] as? String)
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US",
                               "-testURL", "http://localhost:7777/?platform=ios&account=heir&approval=auto"]
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
        amount.tap()
        amount.typeText("1.000001")
        app.buttons["Done"].firstMatch.tap()
        let recipient = web.textFields.matching(NSPredicate(format: "label CONTAINS %@ OR placeholderValue == %@", "Who should receive", "@username or wallet address")).firstMatch
        for _ in 0..<4 {
            if recipient.frame.maxY < app.frame.maxY - 180 && recipient.frame.minY > web.frame.minY + 20 { break }
            web.swipeUp()
        }
        recipient.tap()
        recipient.typeText(recipientAddress)
        app.buttons["Done"].firstMatch.tap()
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
        let confirm = web.buttons["Confirm and deposit"].firstMatch
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
        let saved = web.staticTexts["Finish your saved plan"].firstMatch
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
        let noActivePlan = web.staticTexts["No active inheritance plan. You can manage existing balances in Assets."].firstMatch
        let settledHome = NSPredicate { _, _ in
            web.staticTexts["Assets in your plan"].firstMatch.exists
                && web.staticTexts["USDC"].firstMatch.exists
                && displayedBalance.exists
                && web.staticTexts["Next check-in"].firstMatch.exists
                && checkIn.exists && checkIn.isEnabled
                && !web.staticTexts["Updating…"].firstMatch.exists
                && !web.staticTexts["Checking status…"].firstMatch.exists
                && !noActivePlan.exists
        }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: settledHome, object: nil)], timeout: 60), .completed,
                       "Recovery must render the funded USDC position and an active check-in, not a loading or empty Home")
        for _ in 0..<4 {
            if displayedBalance.isHittable && displayedBalance.frame.maxY <= web.frame.maxY - 80 { break }
            web.swipeUp()
        }
        XCTAssertTrue(displayedBalance.isHittable, "The verified balance must be visible in the recovery screenshot")
        XCTAssertFalse(noActivePlan.exists)
        XCTAssertEqual(try rpcString("eth_getTransactionCount", [account, "latest"]), minedNonce)
        XCTAssertEqual(try rpcString("eth_getTransactionCount", [account, "pending"]), minedNonce, "Recovery must not replay an already submitted deposit")
        capture("pending-deposit-recovered-without-resubmission", app)
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

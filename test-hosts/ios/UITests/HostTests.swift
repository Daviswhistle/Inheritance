import XCTest

final class HostTests: XCTestCase {
    override func tearDown() {
        if (testRun?.failureCount ?? 0) > 0 {
            let app = XCUIApplication()
            capture("failure-screen", app)
            print(app.debugDescription)
        }
        super.tearDown()
    }

    func testRealSDKLoginAndNativeLifecycle() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US",
                               "-testURL", "http://localhost:7777/?platform=ios&approval=manual"]
        app.launch()
        defer { XCUIDevice.shared.orientation = .portrait }
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 60))
        XCTAssertTrue(web.buttons["Home"].firstMatch.waitForExistence(timeout: 120), "Wait for initial JS bootstrap, not merely the WKWebView container\n\(app.debugDescription)")
        for label in ["Assets", "Help", "Home", "Plan"] {
            let tab = web.buttons[label].firstMatch
            XCTAssertTrue(tab.waitForExistence(timeout: 30), "Missing tab: \(label)\n\(app.debugDescription)")
            tab.tap()
        }
        let login = web.buttons["Continue with World App"].firstMatch
        XCTAssertTrue(login.waitForExistence(timeout: 20))
        login.tap()
        let reject = web.buttons["Reject"].firstMatch
        XCTAssertTrue(reject.waitForExistence(timeout: 20))
        reject.tap()
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
        let inputAboveKeyboard = NSPredicate { _, _ in
            recipient.frame.minY >= web.frame.minY && recipient.frame.maxY <= min(app.keyboards.firstMatch.frame.minY, app.buttons["Done"].firstMatch.frame.minY)
        }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: inputAboveKeyboard, object: nil)], timeout: 10), .completed, "Recipient must be fully above keyboard and accessory toolbar")
        capture("native-keyboard", app)
        XCUIDevice.shared.orientation = .landscapeLeft
        let landscape = NSPredicate { _, _ in app.frame.width > app.frame.height }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: landscape, object: nil)], timeout: 10), .completed)
        Thread.sleep(forTimeInterval: 1) // Finish UIKit rotation before recording the screen.
        XCTAssertEqual(recipient.value as? String, "@sam")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: inputAboveKeyboard, object: nil)], timeout: 10), .completed, "Landscape input must remain above keyboard")
        capture("landscape-input-preserved", app)
        XCUIDevice.shared.orientation = .portrait
        let portrait = NSPredicate { _, _ in app.frame.height > app.frame.width }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: portrait, object: nil)], timeout: 10), .completed)
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(recipient.waitForExistence(timeout: 15))
        XCTAssertEqual(recipient.value as? String, "@sam")
        XCTAssertEqual(amount.value as? String, "12.345678")
        capture("foreground-input-preserved", app)
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
        defer {
            _ = try? hostJSON("/__host/control", body: ["action": "mining", "enabled": true])
            app.terminate()
        }
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.buttons["Plan"].firstMatch.waitForExistence(timeout: 120))
        web.buttons["Plan"].firstMatch.tap()
        let login = web.buttons["Continue with World App"].firstMatch
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
        XCTAssertEqual(try rpcString("eth_getTransactionCount", [account, "latest"]), pendingNonce)
        XCTAssertEqual(try rpcString("eth_getTransactionCount", [account, "pending"]), pendingNonce, "Recovery must not replay an already submitted deposit")
        capture("pending-deposit-recovered-without-resubmission", app)
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

    private func capture(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

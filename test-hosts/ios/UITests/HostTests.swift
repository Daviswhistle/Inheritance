import XCTest

final class HostTests: XCTestCase {
    func testRealSDKLoginAndNativeLifecycle() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US",
                               "-testURL", "http://localhost:7777/?platform=ios&approval=auto"]
        app.launch()
        defer { XCUIDevice.shared.orientation = .portrait }
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 60))
        for label in ["Assets", "Help", "Home", "Plan"] {
            let tab = web.buttons[label].firstMatch
            XCTAssertTrue(tab.waitForExistence(timeout: 30), "Missing tab: \(label)\n\(app.debugDescription)")
            tab.tap()
        }
        let login = web.buttons["Continue with World App"].firstMatch
        XCTAssertTrue(login.waitForExistence(timeout: 20))
        login.tap()
        let recipient = web.textFields.matching(NSPredicate(format: "label CONTAINS %@ OR placeholderValue == %@", "Who should receive", "@username or wallet address")).firstMatch
        XCTAssertTrue(recipient.waitForExistence(timeout: 60), "SDK login must reveal the setup form\n\(app.debugDescription)")
        let amount = web.textFields["USDC"].firstMatch
        XCTAssertTrue(amount.waitForExistence(timeout: 10))
        amount.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        amount.typeText("12.345678")
        XCTAssertEqual(amount.value as? String, "12.345678")
        capture("decimal-keyboard", app)
        recipient.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        recipient.typeText("@sam")
        XCTAssertFalse(web.buttons["Review plan"].exists, "Fixed review action must not cover keyboard input")
        capture("native-keyboard", app)
        XCUIDevice.shared.orientation = .landscapeLeft
        let landscape = NSPredicate { _, _ in app.frame.width > app.frame.height }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: landscape, object: nil)], timeout: 10), .completed)
        Thread.sleep(forTimeInterval: 1) // Finish UIKit rotation before recording the screen.
        XCTAssertEqual(recipient.value as? String, "@sam")
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
    }

    private func capture(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

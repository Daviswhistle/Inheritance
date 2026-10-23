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
        recipient.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        recipient.typeText("@sam")
        capture("native-keyboard", app)
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertEqual(recipient.value as? String, "@sam")
        capture("landscape-input-preserved", app)
        XCUIDevice.shared.orientation = .portrait
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(recipient.waitForExistence(timeout: 15))
        XCTAssertEqual(recipient.value as? String, "@sam")
        capture("foreground-input-preserved", app)
    }

    private func capture(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

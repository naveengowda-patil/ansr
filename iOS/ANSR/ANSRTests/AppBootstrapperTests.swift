import Foundation
import Testing
@testable import ANSR

/// `AppBootstrapper` (BLUEPRINT §7.7): an app hosting tests builds nothing, so tests never reach the network.
@MainActor
@Suite("AppBootstrapper")
struct AppBootstrapperTests {
    private let validInfo: [String: Any] = ["API_BASE_URL": "http://localhost:3000", "REQUEST_TIMEOUT_SECONDS": "15"]

    @Test("This test process carries the marker the bootstrapper looks for")
    func testProcessIsMarked() {
        #expect(ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil)
    }

    @Test("When hosting tests, nothing is built, even with valid settings")
    func hostingTestsBuildsNothing() {
        let outcome = AppBootstrapper(infoDictionary: validInfo, environment: ["XCTestConfigurationFilePath": "/tmp/x"]).configure()
        guard case .hostingTests = outcome else {
            Issue.record("Expected .hostingTests, got \(outcome)")
            return
        }
    }

    @Test("Outside tests, an invalid base URL gives the configuration error naming the key")
    func invalidURLIsConfigurationError() {
        let info: [String: Any] = ["API_BASE_URL": "localhost:3000", "REQUEST_TIMEOUT_SECONDS": "15"]
        let outcome = AppBootstrapper(infoDictionary: info, environment: [:]).configure()
        guard case .configurationError(let message) = outcome else {
            Issue.record("Expected .configurationError, got \(outcome)")
            return
        }
        #expect(message == Strings.configurationErrorDetail(key: "API_BASE_URL"))
    }
}

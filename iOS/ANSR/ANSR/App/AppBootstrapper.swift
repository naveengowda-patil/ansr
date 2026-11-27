import Foundation

/// Builds the app from the info dictionary (BLUEPRINT §7.7, D-030): configuration, then dependencies, then coordinator.
/// It only reads values and builds objects; it makes no network calls, so the first frame is never delayed.
@MainActor
struct AppBootstrapper {
    enum Outcome {
        case ready(AppCoordinator)
        case configurationError(message: String)
        /// The process is hosting unit tests: nothing is built, so tests never reach the network or the image cache.
        case hostingTests
    }

    /// Set by Xcode in the environment of an app that hosts a test bundle.
    private static let testConfigurationKey = "XCTestConfigurationFilePath"

    private let infoDictionary: [String: Any]
    private let environment: [String: String]

    init(infoDictionary: [String: Any], environment: [String: String]) {
        self.infoDictionary = infoDictionary
        self.environment = environment
    }

    func configure() -> Outcome {
        guard environment[Self.testConfigurationKey] == nil else { return .hostingTests }
        let configuration: AppConfiguration
        do {
            configuration = try AppConfiguration(infoDictionary: infoDictionary)
        } catch {
            return .configurationError(message: Strings.configurationErrorDetail(key: error.key))
        }
        let dependencies = AppDependencies.live(configuration)
        return .ready(AppCoordinator(dependencies: dependencies))
    }
}

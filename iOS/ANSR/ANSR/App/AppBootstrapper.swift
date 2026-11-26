import Foundation

/// Builds the app from the info dictionary (BLUEPRINT §7.7, D-030): configuration, then dependencies, then coordinator.
/// It only reads values and builds objects; it makes no network calls, so the first frame is never delayed.
@MainActor
struct AppBootstrapper {
    enum Outcome {
        case ready(AppCoordinator)
        case configurationError(message: String)
    }

    private let infoDictionary: [String: Any]

    init(infoDictionary: [String: Any]) {
        self.infoDictionary = infoDictionary
    }

    func configure() -> Outcome {
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

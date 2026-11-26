import SwiftUI
import UIKit

/// Creates the window and shows Home, or `ConfigurationErrorView` when the build settings are wrong (BLUEPRINT §7.7).
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    /// Kept alive for the life of the scene.
    private var coordinator: AppCoordinator?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)

        switch AppBootstrapper(infoDictionary: Bundle.main.infoDictionary ?? [:]).configure() {
        case .ready(let coordinator):
            self.coordinator = coordinator
            window.rootViewController = UIHostingController(rootView: coordinator.rootView())
        case .configurationError(let message):
            window.rootViewController = UIHostingController(rootView: ConfigurationErrorView(message: message))
        }

        self.window = window
        window.makeKeyAndVisible()
    }
}

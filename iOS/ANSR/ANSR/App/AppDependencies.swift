import UIKit

/// Everything screens may use, as protocols only (BLUEPRINT §7.7). The coordinator passes each view model just what it needs.
struct AppDependencies: Sendable {
    let productRepository: any ProductRepository
    let categoryRepository: any CategoryRepository
    let enquiryRepository: any EnquiryRepository
    let imageProvider: any ImageProvider
    let theme: AppTheme
    let locale: Locale
}

extension AppDependencies {
    /// The composition root: the only place concrete types are created.
    @MainActor
    static func live(_ configuration: AppConfiguration) -> AppDependencies {
        let sessionConfiguration = URLSessionConfiguration.default
        sessionConfiguration.timeoutIntervalForRequest = configuration.requestTimeout
        sessionConfiguration.waitsForConnectivity = false   // offline fails fast as .offline
        sessionConfiguration.urlCache = nil                  // images are cached once, in HybridImageProvider
        sessionConfiguration.requestCachePolicy = .reloadIgnoringLocalCacheData

        let client = URLSessionNetworkClient(
            session: URLSession(configuration: sessionConfiguration),
            baseURL: configuration.apiBaseURL
        )
        let imageProvider = HybridImageProvider(
            client: client,
            directory: URL.cachesDirectory.appending(path: "ProductImages", directoryHint: .isDirectory),
            notificationCenter: .default,
            application: .shared,
            limits: HybridImageProvider.Limits(
                memoryCountLimit: 100,
                diskByteLimit: 50 * 1024 * 1024,
                diskWriteDelay: .seconds(2)
            )
        )

        return AppDependencies(
            productRepository: RemoteProductRepository(client: client),
            categoryRepository: RemoteCategoryRepository(client: client),
            enquiryRepository: RemoteEnquiryRepository(client: client),
            imageProvider: imageProvider,
            theme: .standard,
            locale: .current
        )
    }
}

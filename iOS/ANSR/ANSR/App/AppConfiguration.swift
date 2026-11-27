import Foundation

/// The build-time settings, read once from `Info.plist` (BLUEPRINT §7.7). The only code that reads these keys:
/// there is no URL or timeout anywhere in Swift source.
struct AppConfiguration: Sendable, Equatable {
    /// A missing or invalid setting, named by its `Info.plist` key.
    struct InvalidSetting: Error, Equatable {
        let key: String
    }

    static let apiBaseURLKey = "API_BASE_URL"
    static let requestTimeoutKey = "REQUEST_TIMEOUT_SECONDS"

    let apiBaseURL: URL
    let requestTimeout: TimeInterval

    /// Throws when the URL isn't an absolute `http`/`https` URL with a host, or the timeout isn't a positive number.
    init(infoDictionary: [String: Any]) throws(InvalidSetting) {
        guard let urlText = infoDictionary[Self.apiBaseURLKey] as? String,
              let url = URL(string: urlText.trimmingCharacters(in: .whitespaces)),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host(), !host.isEmpty
        else {
            throw InvalidSetting(key: Self.apiBaseURLKey)
        }
        guard let timeoutText = infoDictionary[Self.requestTimeoutKey] as? String,
              let timeout = TimeInterval(timeoutText.trimmingCharacters(in: .whitespaces)),
              timeout.isFinite, timeout > 0
        else {
            throw InvalidSetting(key: Self.requestTimeoutKey)
        }
        self.apiBaseURL = url
        self.requestTimeout = timeout
    }
}

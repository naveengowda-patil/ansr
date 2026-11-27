import Foundation

/// One request to our backend: method, path, query and body (BLUEPRINT §7.5).
///
/// It never carries an empty value: a `nil` query value, or a string that is empty after trimming, is dropped here,
/// because the backend rejects present-but-empty parameters with 400 (§6.4).
struct Endpoint: Sendable {
    enum Method: String, Sendable {
        case get = "GET"
        case post = "POST"
    }

    let method: Method
    /// Unencoded path segments, e.g. `["categories", "men's clothing"]`. Each is percent-encoded on its own.
    let pathSegments: [String]
    /// Only non-empty, trimmed values.
    let queryItems: [URLQueryItem]
    /// Encoded as JSON by the network client.
    let body: (any Encodable & Sendable)?

    init(
        method: Method = .get,
        pathSegments: [String],
        query: [(name: String, value: String?)] = [],
        body: (any Encodable & Sendable)? = nil
    ) {
        self.method = method
        self.pathSegments = pathSegments
        self.queryItems = query.compactMap { item in
            guard let value = item.value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
                return nil
            }
            return URLQueryItem(name: item.name, value: value)
        }
        self.body = body
    }

    /// The full URL under `baseURL`, built with `URLComponents` (never by joining strings).
    func url(relativeTo baseURL: URL) -> URL? {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else { return nil }
        let basePath = components.percentEncodedPath.hasSuffix("/")
            ? String(components.percentEncodedPath.dropLast())
            : components.percentEncodedPath
        let encodedSegments = pathSegments.compactMap { $0.addingPercentEncoding(withAllowedCharacters: Self.segmentAllowed) }
        guard encodedSegments.count == pathSegments.count else { return nil }
        components.percentEncodedPath = basePath + "/" + encodedSegments.joined(separator: "/")
        components.percentEncodedQueryItems = queryItems.isEmpty ? nil : queryItems.map { item in
            URLQueryItem(
                name: item.name.addingPercentEncoding(withAllowedCharacters: Self.queryValueAllowed) ?? item.name,
                value: item.value?.addingPercentEncoding(withAllowedCharacters: Self.queryValueAllowed)
            )
        }
        return components.url
    }

    /// Path characters, without `/`, so a value never splits into two segments.
    private static let segmentAllowed: CharacterSet = {
        var set = CharacterSet.urlPathAllowed
        set.remove("/")
        return set
    }()

    /// Query characters, without the ones a server reads as separators or as a space (`+`).
    private static let queryValueAllowed: CharacterSet = {
        var set = CharacterSet.urlQueryAllowed
        set.remove(charactersIn: "&=+?#/")
        return set
    }()
}

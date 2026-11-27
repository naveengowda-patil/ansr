import Foundation

/// `NetworkClient` over `URLSession` (BLUEPRINT §7.5). The only type that uses `URLSession`, `URLRequest`,
/// `JSONEncoder` or `JSONDecoder` for network calls. Its functions are `nonisolated async`, so encoding and
/// decoding run off the main actor.
struct URLSessionNetworkClient: NetworkClient {
    private let session: URLSession
    private let baseURL: URL

    /// - Parameters:
    ///   - session: built by the composition root with the request timeout, `waitsForConnectivity = false` and no URL cache.
    ///   - baseURL: `AppConfiguration.apiBaseURL`.
    init(session: URLSession, baseURL: URL) {
        self.session = session
        self.baseURL = baseURL
    }

    func send<Response: Decodable & Sendable>(_ endpoint: Endpoint, as type: Response.Type) async throws(APIError) -> Response {
        let body = try await perform(endpoint, accept: "application/json")
        do {
            return try JSONDecoder().decode(Response.self, from: body)
        } catch {
            throw .decoding
        }
    }

    func data(for endpoint: Endpoint) async throws(APIError) -> Data {
        try await perform(endpoint, accept: nil)
    }

    private func perform(_ endpoint: Endpoint, accept: String?) async throws(APIError) -> Data {
        let request = try makeRequest(endpoint, accept: accept)
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError(transportError: error)
        }
        guard let http = response as? HTTPURLResponse else { throw .transport }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError(status: http.statusCode, body: data)
        }
        return data
    }

    private func makeRequest(_ endpoint: Endpoint, accept: String?) throws(APIError) -> URLRequest {
        guard let url = endpoint.url(relativeTo: baseURL) else { throw .transport }
        var request = URLRequest(url: url)
        request.httpMethod = endpoint.method.rawValue
        if let accept {
            request.setValue(accept, forHTTPHeaderField: "Accept")
        }
        if let body = endpoint.body {
            do {
                request.httpBody = try JSONEncoder().encode(body)
            } catch {
                throw .transport
            }
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }
}

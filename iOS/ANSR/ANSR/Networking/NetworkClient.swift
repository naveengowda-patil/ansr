import Foundation

/// The only way the app talks HTTP (BLUEPRINT §7.5). Images go through it too.
protocol NetworkClient: Sendable {
    /// Sends the request and decodes a JSON body.
    func send<Response: Decodable & Sendable>(_ endpoint: Endpoint, as type: Response.Type) async throws(APIError) -> Response
    /// Sends the request and returns the raw body, for images.
    func data(for endpoint: Endpoint) async throws(APIError) -> Data
}

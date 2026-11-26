import Foundation

/// Every way a request can fail, typed (BLUEPRINT §7.5). Turned into user-facing text only by `ErrorMessages`.
enum APIError: Error, Equatable, Sendable {
    /// 400 `VALIDATION_ERROR`. The message is the backend's safe text, never shown to the user as is.
    case validation(message: String)
    /// 404 `NOT_FOUND`.
    case notFound
    /// 502 `UPSTREAM_ERROR`.
    case upstream
    /// 500 `INTERNAL_ERROR`, or any other non-2xx status or unknown body.
    case server(status: Int)
    /// Not connected, or the connection was lost.
    case offline
    /// The request timed out.
    case timeout
    /// The screen was left. Never shown; view models ignore it.
    case cancelled
    /// The response body doesn't decode.
    case decoding
    /// Any other transport failure.
    case transport
}

extension APIError {
    /// Maps a non-2xx response, using the backend's error envelope (§5.9). The status and the code must agree.
    init(status: Int, body: Data) {
        let code = (try? JSONDecoder().decode(ErrorEnvelope.self, from: body))?.error
        switch (status, code?.code) {
        case (400, ErrorEnvelope.Code.validation):
            self = .validation(message: code?.message ?? "")
        case (404, ErrorEnvelope.Code.notFound):
            self = .notFound
        case (502, ErrorEnvelope.Code.upstream):
            self = .upstream
        default:
            self = .server(status: status)
        }
    }

    /// Maps a failure thrown by `URLSession` (or a cancelled task).
    init(transportError error: any Error) {
        if error is CancellationError {
            self = .cancelled
            return
        }
        guard let urlError = error as? URLError else {
            self = .transport
            return
        }
        switch urlError.code {
        case .notConnectedToInternet, .networkConnectionLost:
            self = .offline
        case .timedOut:
            self = .timeout
        case .cancelled:
            self = .cancelled
        default:
            self = .transport
        }
    }
}

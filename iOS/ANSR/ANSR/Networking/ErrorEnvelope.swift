import Foundation

/// The backend's single error format: `{ "error": { "code": "...", "message": "..." } }` (BLUEPRINT §5.9).
struct ErrorEnvelope: Decodable, Sendable {
    struct Body: Decodable, Sendable {
        let code: String
        let message: String
    }

    /// The four codes the backend sends.
    enum Code {
        static let validation = "VALIDATION_ERROR"
        static let notFound = "NOT_FOUND"
        static let upstream = "UPSTREAM_ERROR"
        static let internalError = "INTERNAL_ERROR"
    }

    let error: Body
}

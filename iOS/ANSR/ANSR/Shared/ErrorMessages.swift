import Foundation

/// Turns an `APIError` into user-facing text (BLUEPRINT §7.5). Raw errors are never shown.
enum ErrorMessages {
    static func message(for error: APIError) -> String {
        switch error {
        case .offline: Strings.errorOffline
        case .timeout: Strings.errorTimeout
        case .unreachable: Strings.errorUnreachable
        case .upstream: Strings.errorUpstream
        case .validation: Strings.errorValidation
        case .notFound: Strings.errorNotFound
        case .server, .decoding, .transport, .cancelled: Strings.errorGeneric
        }
    }
}

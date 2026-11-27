import Foundation

/// Turns an `APIError` into user-facing text (BLUEPRINT §7.5). Raw errors are never shown.
enum ErrorMessages {
    /// A screen that knows what a 404 means passes its own `notFoundMessage` (the enquiry sheet: the product is gone).
    static func message(for error: APIError, notFoundMessage: String = Strings.errorNotFound) -> String {
        switch error {
        case .offline: Strings.errorOffline
        case .timeout: Strings.errorTimeout
        case .unreachable: Strings.errorUnreachable
        case .upstream: Strings.errorUpstream
        case .validation: Strings.errorValidation
        case .notFound: notFoundMessage
        case .server, .decoding, .transport, .cancelled: Strings.errorGeneric
        }
    }
}

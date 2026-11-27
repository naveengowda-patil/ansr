import Foundation

/// The enquiry form's rules (BLUEPRINT §7.8.5), copied from the backend's `POST /enquiries` validation (§6.9, D-038).
/// Pure functions: raw field text in, an error message or a request out.
///
/// To match the backend, lengths are counted in Unicode code points (as zod's `max()` counts them), and control
/// characters are checked on the raw text, before trimming.
enum EnquiryValidation {
    static let maxNameLength = 100
    static let maxEmailLength = 254
    static let maxMessageLength = 2000

    /// The name's error, or `nil` when it's valid.
    static func nameError(_ raw: String) -> String? {
        if containsControlCharacters(raw) { return Strings.enquiryNameLineBreak }
        let name = trimmed(raw)
        if name.isEmpty { return Strings.enquiryNameRequired }
        if name.unicodeScalars.count > maxNameLength { return Strings.enquiryNameTooLong }
        return nil
    }

    /// The email's error, or `nil` when it's valid.
    static func emailError(_ raw: String) -> String? {
        if containsControlCharacters(raw) { return Strings.enquiryEmailLineBreak }
        let email = trimmed(raw)
        if email.unicodeScalars.count > maxEmailLength { return Strings.enquiryEmailTooLong }
        if !isEmailShaped(email) { return Strings.enquiryEmailInvalid }
        return nil
    }

    /// The message's error, or `nil` when it's valid. A blank message is valid: it isn't sent.
    static func messageError(_ raw: String) -> String? {
        if isBlank(raw) { return nil }
        if raw.unicodeScalars.count > maxMessageLength { return Strings.enquiryMessageTooLong }
        return nil
    }

    /// The request to send, or `nil` while any field is invalid. Name and email are trimmed; a blank message is `nil`.
    static func request(productId: Int, name: String, email: String, message: String) -> EnquiryRequest? {
        guard nameError(name) == nil, emailError(email) == nil, messageError(message) == nil else { return nil }
        return EnquiryRequest(
            productId: productId,
            name: trimmed(name),
            email: trimmed(email),
            message: isBlank(message) ? nil : message
        )
    }

    // MARK: - Helpers

    private static func trimmed(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func isBlank(_ text: String) -> Bool {
        trimmed(text).isEmpty
    }

    /// U+0000–U+001F and U+007F, as the backend's `/[\u0000-\u001F\u007F]/`.
    private static func containsControlCharacters(_ text: String) -> Bool {
        text.unicodeScalars.contains { $0.value <= 0x1F || $0.value == 0x7F }
    }

    /// The pattern zod 4.6.7 uses for `z.email()` on the backend, copied exactly.
    private static func isEmailShaped(_ email: String) -> Bool {
        email.wholeMatch(of: #/(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}/#) != nil
    }
}

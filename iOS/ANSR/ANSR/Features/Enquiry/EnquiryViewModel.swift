import Foundation
import Observation

/// Where the enquiry form is (BLUEPRINT §7.8.5, D-038).
enum EnquiryFormState: Equatable {
    case editing
    case submitting
    /// The thank-you text.
    case submitted(message: String)
    /// The form again, editable, with this error above it.
    case failed(message: String)
}

/// The Enquiry sheet's fields, state and intents (BLUEPRINT §7.8.5, AC-5). The field values live here; the view binds to them.
@MainActor @Observable
final class EnquiryViewModel {
    let productId: Int
    let productTitle: String
    private(set) var state: EnquiryFormState = .editing

    var name = "" {
        didSet { if name != oldValue { isNameEdited = true } }
    }
    var email = "" {
        didSet { if email != oldValue { isEmailEdited = true } }
    }
    var message = "" {
        didSet { if message != oldValue { isMessageEdited = true } }
    }

    private var isNameEdited = false
    private var isEmailEdited = false
    private var isMessageEdited = false

    @ObservationIgnored private let enquiryRepository: any EnquiryRepository
    @ObservationIgnored private weak var navigator: (any EnquiryNavigating)?

    init(productId: Int, productTitle: String, enquiryRepository: any EnquiryRepository, navigator: any EnquiryNavigating) {
        self.productId = productId
        self.productTitle = productTitle
        self.enquiryRepository = enquiryRepository
        self.navigator = navigator
    }

    // MARK: - Field errors (shown only once the field has been edited)

    var nameError: String? { isNameEdited ? EnquiryValidation.nameError(name) : nil }
    var emailError: String? { isEmailEdited ? EnquiryValidation.emailError(email) : nil }
    var messageError: String? { isMessageEdited ? EnquiryValidation.messageError(message) : nil }

    // MARK: - What the view can do

    /// The form can be edited and submitted: `editing`, or `failed` with the error shown.
    var isEditable: Bool {
        switch state {
        case .editing, .failed: true
        case .submitting, .submitted: false
        }
    }

    var isSubmitting: Bool { state == .submitting }

    /// Swipe-to-dismiss is blocked only while submitting.
    var isDismissDisabled: Bool { isSubmitting }

    var canSubmit: Bool { isEditable && validRequest != nil }

    /// The failure shown above the form, if any.
    var failureMessage: String? {
        if case .failed(let message) = state { message } else { nil }
    }

    private var validRequest: EnquiryRequest? {
        EnquiryValidation.request(productId: productId, name: name, email: email, message: message)
    }

    // MARK: - Intents

    /// Sends the enquiry. Ignored while the form is invalid, while a submit is running, and once submitted.
    func submit() async {
        guard isEditable, let request = validRequest else { return }
        state = .submitting
        do {
            _ = try await enquiryRepository.submit(request)
            state = .submitted(message: Strings.enquiryThanks(name: request.name, email: request.email))
        } catch .cancelled {
            state = .editing
        } catch {
            state = .failed(message: ErrorMessages.message(for: error, notFoundMessage: Strings.productNotFound))
        }
    }

    /// Closes the sheet. Ignored while submitting.
    func didTapCancel() {
        guard isEditable else { return }
        navigator?.dismissSheet()
    }

    /// Closes the sheet after the thank-you.
    func didTapDone() {
        guard case .submitted = state else { return }
        navigator?.dismissSheet()
    }
}

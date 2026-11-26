import Foundation
import Testing
@testable import ANSR

/// `EnquiryViewModel` (BLUEPRINT §9.2, §7.8.5, AC-5).
@MainActor
@Suite("EnquiryViewModel")
struct EnquiryViewModelTests {
    private let repository = StubEnquiryRepository()
    private let navigator = RecordingEnquiryNavigator()
    private let viewModel: EnquiryViewModel

    init() {
        viewModel = EnquiryViewModel(
            productId: 3,
            productTitle: "Mens Cotton Jacket",
            enquiryRepository: repository,
            navigator: navigator
        )
    }

    private func fillValidForm() {
        viewModel.name = "Ada Lovelace"
        viewModel.email = "ada@example.com"
        viewModel.message = "Is it waterproof?"
    }

    // MARK: - Valid (AC-5)

    @Test("A valid form sends exactly one request: Int id, trimmed name and email, nil blank message; then the thank-you")
    func validFormSendsTheRequest() async {
        viewModel.name = "  Ada Lovelace "
        viewModel.email = " ada@example.com  "
        viewModel.message = "  \n "
        #expect(viewModel.canSubmit)

        await viewModel.submit()

        #expect(await repository.requests == [
            EnquiryRequest(productId: 3, name: "Ada Lovelace", email: "ada@example.com", message: nil),
        ])
        #expect(viewModel.state == .submitted(message: "Thank you, Ada Lovelace. Our sales team will reply to ada@example.com soon."))
    }

    @Test("A message that isn't blank is sent as typed")
    func messageIsSentAsTyped() async {
        fillValidForm()
        await viewModel.submit()
        #expect(await repository.requests.map(\.message) == ["Is it waterproof?"])
    }

    @Test("While submitting: the state is submitting, a second submit is ignored, and dismissal is blocked")
    func submittingBlocksSecondSubmitAndDismissal() async {
        fillValidForm()
        #expect(!viewModel.isDismissDisabled)
        let hold = Hold()
        await repository.holdSubmit(hold)

        let first = Task { await viewModel.submit() }
        await hold.untilArrived()

        #expect(viewModel.state == .submitting)
        #expect(viewModel.isDismissDisabled)
        #expect(!viewModel.canSubmit)
        await viewModel.submit()
        viewModel.didTapCancel()
        #expect(navigator.dismissCount == 0)

        await hold.release()
        await first.value
        #expect(await repository.requests.count == 1)
        #expect(!viewModel.isDismissDisabled)
        guard case .submitted = viewModel.state else {
            Issue.record("Expected submitted, got \(viewModel.state)")
            return
        }
    }

    // MARK: - Invalid

    @Test("Each invalid form blocks Submit and sends nothing", arguments: [
        ("", "ada@example.com", ""),                                             // empty name
        ("   ", "ada@example.com", ""),                                          // whitespace-only name
        ("Ada\nLovelace", "ada@example.com", ""),                                // line break in the name
        ("Ada Lovelace\n", "ada@example.com", ""),                               // trailing line break, checked before trimming
        ("Ada Lovelace", "ada@example", ""),                                     // no top-level domain
        ("Ada Lovelace", "ada@example.", ""),                                    // empty top-level domain
        ("Ada Lovelace", "ada@example.c", ""),                                   // one-letter top-level domain
        ("Ada Lovelace", ".ada@example.com", ""),                                // leading dot
        ("Ada Lovelace", "ada example.com", ""),                                 // no @, a space
        ("Ada Lovelace", "ada@exa mple.com", ""),                                // a space in the domain
        (String(repeating: "a", count: 101), "ada@example.com", ""),             // name over 100
        ("Ada Lovelace", "ada@example.com", String(repeating: "m", count: 2001)), // message over 2000
    ])
    func invalidFormBlocksSubmit(name: String, email: String, message: String) async {
        viewModel.name = name
        viewModel.email = email
        viewModel.message = message
        #expect(!viewModel.canSubmit)

        await viewModel.submit()

        #expect(await repository.requests.isEmpty)
        #expect(viewModel.state == .editing)
    }

    @Test("Addresses the backend accepts are accepted", arguments: [
        "ada@example.com",
        "o'brien+news@mail.example.co.uk",
        "first.last-name_1@sub-domain.example.org",
    ])
    func validEmailsAreAccepted(email: String) {
        viewModel.name = "Ada"
        viewModel.email = email
        #expect(viewModel.canSubmit)
        #expect(viewModel.emailError == nil)
    }

    @Test("The limits themselves are allowed: a 100-character name and a 2000-character message")
    func limitsAreAllowed() {
        viewModel.name = String(repeating: "a", count: 100)
        viewModel.email = "ada@example.com"
        viewModel.message = String(repeating: "m", count: 2000)
        #expect(viewModel.canSubmit)
    }

    @Test("Lengths count code points like the backend's zod: 100 emoji fit, 101 don't, and e plus an accent counts as 2")
    func lengthsCountCodePoints() {
        viewModel.email = "ada@example.com"
        viewModel.name = String(repeating: "😀", count: 100)
        #expect(viewModel.canSubmit)
        viewModel.name = String(repeating: "😀", count: 101)
        #expect(!viewModel.canSubmit)
        viewModel.name = String(repeating: "e\u{301}", count: 51) // 51 characters, 102 code points
        #expect(!viewModel.canSubmit)
    }

    @Test("A field's error shows only once that field has been edited")
    func errorsShowOnlyOnceEdited() {
        #expect(!viewModel.canSubmit)
        #expect(viewModel.nameError == nil)
        #expect(viewModel.emailError == nil)
        #expect(viewModel.messageError == nil)

        viewModel.email = "ada@"
        #expect(viewModel.emailError == "Enter a valid email address.")
        #expect(viewModel.nameError == nil)

        viewModel.name = "Ada"
        viewModel.name = ""
        #expect(viewModel.nameError == "Enter your name.")
    }

    // MARK: - Failure

    @Test("A failure shows the message, keeps every field, and a resubmit works")
    func failureKeepsFieldsAndResubmits() async {
        fillValidForm()
        await repository.setResult(.failure(.unreachable))

        await viewModel.submit()

        #expect(viewModel.state == .failed(message: "Can't reach the server. Please try again later."))
        #expect(viewModel.failureMessage == "Can't reach the server. Please try again later.")
        #expect(viewModel.name == "Ada Lovelace")
        #expect(viewModel.email == "ada@example.com")
        #expect(viewModel.message == "Is it waterproof?")
        #expect(viewModel.canSubmit)

        await repository.setResult(.success(EnquiryResponse(status: "sent")))
        await viewModel.submit()

        #expect(await repository.requests.count == 2)
        #expect(viewModel.state == .submitted(message: "Thank you, Ada Lovelace. Our sales team will reply to ada@example.com soon."))
    }

    @Test("A 404 means the product is no longer available")
    func notFoundMessage() async {
        fillValidForm()
        await repository.setResult(.failure(.notFound))

        await viewModel.submit()

        #expect(viewModel.state == .failed(message: "This product is no longer available."))
    }

    // MARK: - Closing

    @Test("Cancel while editing calls dismissSheet")
    func cancelDismisses() {
        viewModel.didTapCancel()
        #expect(navigator.dismissCount == 1)
    }

    @Test("Done after the thank-you calls dismissSheet")
    func doneDismisses() async {
        viewModel.didTapDone()
        #expect(navigator.dismissCount == 0)

        fillValidForm()
        await viewModel.submit()
        viewModel.didTapDone()

        #expect(navigator.dismissCount == 1)
    }
}

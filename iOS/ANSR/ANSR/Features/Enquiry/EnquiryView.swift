import SwiftUI

/// The Enquiry sheet (BLUEPRINT §7.8.5, AC-5): the product it's about, then name, email and an optional message.
/// A dumb view: it binds to `EnquiryViewModel`'s fields and calls its intents. The only state it owns is keyboard focus.
struct EnquiryView: View {
    @State private var viewModel: EnquiryViewModel
    @Environment(\.theme) private var theme
    @FocusState private var focusedField: Field?

    private enum Field {
        case name, email, message
    }

    init(viewModel: EnquiryViewModel) {
        _viewModel = State(initialValue: viewModel)
    }

    var body: some View {
        NavigationStack {
            content
                .background(theme.colors.background)
                .navigationTitle(Strings.enquiryTitle)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    if !isSubmitted {
                        ToolbarItem(placement: .cancellationAction) {
                            Button(Strings.enquiryCancel, action: viewModel.didTapCancel)
                                .disabled(!viewModel.isEditable)
                        }
                    }
                }
        }
        .interactiveDismissDisabled(viewModel.isDismissDisabled)
    }

    private var isSubmitted: Bool {
        if case .submitted = viewModel.state { true } else { false }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .submitted(let message):
            thanks(message)
        case .editing, .submitting, .failed:
            form
        }
    }

    private var form: some View {
        Form {
            if let failure = viewModel.failureMessage {
                Section {
                    Text(failure)
                        .font(theme.fonts.body)
                        .foregroundStyle(theme.colors.error)
                }
            }

            Section(Strings.enquiryAbout) {
                Text(viewModel.productTitle)
                    .font(theme.fonts.headline)
                    .foregroundStyle(theme.colors.primaryText)
            }

            Section {
                field(error: viewModel.nameError) {
                    TextField(Strings.enquiryName, text: $viewModel.name)
                        .textContentType(.name)
                        .textInputAutocapitalization(.words)
                        .submitLabel(.next)
                        .focused($focusedField, equals: .name)
                        .onSubmit { focusedField = .email }
                }
                field(error: viewModel.emailError) {
                    TextField(Strings.enquiryEmail, text: $viewModel.email)
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.next)
                        .focused($focusedField, equals: .email)
                        .onSubmit { focusedField = .message }
                }
                field(error: viewModel.messageError) {
                    TextField(Strings.enquiryMessage, text: $viewModel.message, axis: .vertical)
                        .lineLimit(3...8)
                        .focused($focusedField, equals: .message)
                }
            }
            .disabled(viewModel.isSubmitting)

            Section {
                Button {
                    focusedField = nil
                    Task { await viewModel.submit() }
                } label: {
                    HStack(spacing: theme.spacing.small) {
                        Text(Strings.enquirySubmit)
                            .font(theme.fonts.headline)
                        if viewModel.isSubmitting {
                            ProgressView()
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .disabled(!viewModel.canSubmit)
            }
        }
    }

    /// A field with its error underneath, once there is one.
    private func field<Input: View>(error: String?, @ViewBuilder input: () -> Input) -> some View {
        VStack(alignment: .leading, spacing: theme.spacing.extraSmall) {
            input()
                .font(theme.fonts.body)
            if let error {
                Text(error)
                    .font(theme.fonts.caption)
                    .foregroundStyle(theme.colors.error)
            }
        }
    }

    private func thanks(_ message: String) -> some View {
        VStack(spacing: theme.spacing.large) {
            Text(message)
                .font(theme.fonts.body)
                .foregroundStyle(theme.colors.primaryText)
                .multilineTextAlignment(.center)
            Button(Strings.enquiryDone, action: viewModel.didTapDone)
                .font(theme.fonts.headline)
                .buttonStyle(.borderedProminent)
        }
        .padding(.horizontal, theme.spacing.extraLarge)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#if DEBUG
#Preview {
    let dependencies = AppDependencies.mock
    EnquiryView(viewModel: EnquiryViewModel(
        productId: 1,
        productTitle: MockData.products[0].title,
        enquiryRepository: dependencies.enquiryRepository,
        navigator: AppCoordinator(dependencies: dependencies)
    ))
}
#endif

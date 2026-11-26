import SwiftUI

/// Shows a screen's `ViewState` (BLUEPRINT §7.11): a spinner, the empty message, the error with Retry, or the content.
struct StateContainerView<Value, Content: View>: View {
    let state: ViewState<Value>
    let emptyMessage: String
    let retry: () -> Void
    @ViewBuilder let content: (Value) -> Content

    @Environment(\.theme) private var theme

    var body: some View {
        switch state {
        case .loading:
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded(let value):
            content(value)
        case .empty:
            message(emptyMessage)
        case .error(let text):
            VStack(spacing: theme.spacing.large) {
                message(text)
                Button(Strings.retry, action: retry)
                    .buttonStyle(.borderedProminent)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func message(_ text: String) -> some View {
        Text(text)
            .font(theme.fonts.body)
            .foregroundStyle(theme.colors.secondaryText)
            .multilineTextAlignment(.center)
            .padding(theme.spacing.extraLarge)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#if DEBUG
#Preview("Error") {
    StateContainerView(state: ViewState<String>.error(message: Strings.errorOffline), emptyMessage: Strings.homeEmpty, retry: {}) { Text($0) }
}
#endif

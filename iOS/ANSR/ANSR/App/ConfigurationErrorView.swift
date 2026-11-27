import SwiftUI

/// Shown instead of Home when `API_BASE_URL` or `REQUEST_TIMEOUT_SECONDS` is missing or invalid (BLUEPRINT §7.7, §7.11).
/// There's no Retry: configuration is fixed at build time.
struct ConfigurationErrorView: View {
    let message: String

    @Environment(\.theme) private var theme

    var body: some View {
        VStack(spacing: theme.spacing.medium) {
            Image(systemName: "exclamationmark.triangle")
                .font(theme.fonts.title)
                .foregroundStyle(theme.colors.secondaryText)
            Text(Strings.configurationErrorTitle)
                .font(theme.fonts.headline)
                .foregroundStyle(theme.colors.primaryText)
            Text(message)
                .font(theme.fonts.body)
                .foregroundStyle(theme.colors.secondaryText)
        }
        .multilineTextAlignment(.center)
        .padding(theme.spacing.extraLarge)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.colors.background)
    }
}

#if DEBUG
#Preview {
    ConfigurationErrorView(message: Strings.configurationErrorDetail(key: AppConfiguration.apiBaseURLKey))
}
#endif

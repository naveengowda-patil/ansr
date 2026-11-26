import SwiftUI

/// Phase 1 stand-in for Home (BLUEPRINT §7.8.1). Replaced by `HomeView` + `HomeViewModel` in phase 2.
struct HomePlaceholderView: View {
    @Environment(\.theme) private var theme

    var body: some View {
        Text(Strings.homePlaceholder)
            .font(theme.fonts.body)
            .foregroundStyle(theme.colors.secondaryText)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(theme.colors.background)
            .navigationTitle(Strings.homeTitle)
            .navigationBarTitleDisplayMode(.large)
    }
}

#if DEBUG
#Preview {
    NavigationStack { HomePlaceholderView() }
}
#endif

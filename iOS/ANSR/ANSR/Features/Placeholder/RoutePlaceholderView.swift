import SwiftUI

/// Temporary screen for a route whose real screen isn't built yet (BLUEPRINT §7.8). It says which route opened it,
/// so navigation can be checked at runtime. Each one is replaced as its screen lands.
struct RoutePlaceholderView: View {
    let title: String

    @Environment(\.theme) private var theme

    var body: some View {
        Text(title)
            .font(theme.fonts.title)
            .foregroundStyle(theme.colors.primaryText)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(theme.colors.background)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
    }
}

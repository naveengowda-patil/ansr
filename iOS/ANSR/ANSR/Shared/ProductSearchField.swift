import SwiftUI

extension View {
    /// The product search field shared by Home and Search results (BLUEPRINT §7.8): always visible in the navigation bar,
    /// "Search products" prompt, no auto-capitalisation or autocorrection, and submit on the keyboard's Search key.
    func productSearchField(text: Binding<String>, onSubmit: @escaping () -> Void) -> some View {
        searchable(text: text, placement: .navigationBarDrawer(displayMode: .always), prompt: Strings.searchPrompt)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .onSubmit(of: .search, onSubmit)
    }
}

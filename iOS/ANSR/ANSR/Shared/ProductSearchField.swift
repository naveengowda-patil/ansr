import SwiftUI

extension View {
    /// The product search field shared by Home and Search results (BLUEPRINT §7.8): always visible in the navigation bar,
    /// "Search products" prompt, no auto-capitalisation or autocorrection, and submit on the keyboard's Search key.
    /// `isPresented` is the view model's search mode, so the view model can end it after a submit that navigates.
    func productSearchField(text: Binding<String>, isPresented: Binding<Bool>, onSubmit: @escaping () -> Void) -> some View {
        searchable(text: text, isPresented: isPresented, placement: .navigationBarDrawer(displayMode: .always), prompt: Strings.searchPrompt)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .onSubmit(of: .search, onSubmit)
    }
}

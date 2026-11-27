import SwiftUI

/// The navigation shell (BLUEPRINT §7.4): one `NavigationStack(path:)` rooted at Home, destinations for `Route`,
/// and one sheet. It holds no navigation state: the bindings and the screens all come from `AppCoordinator`.
struct CoordinatorView<Root: View, Destination: View, SheetContent: View>: View {
    @Binding var path: [Route]
    @Binding var sheet: Sheet?
    let theme: AppTheme
    @ViewBuilder let root: () -> Root
    @ViewBuilder let destination: (Route) -> Destination
    @ViewBuilder let sheetContent: (Sheet) -> SheetContent

    var body: some View {
        NavigationStack(path: $path) {
            root()
                .navigationDestination(for: Route.self) { route in
                    destination(route)
                }
        }
        .sheet(item: $sheet) { sheet in
            sheetContent(sheet)
                .environment(\.theme, theme)
        }
        .environment(\.theme, theme)
    }
}

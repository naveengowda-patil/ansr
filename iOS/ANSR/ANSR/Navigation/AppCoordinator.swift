import SwiftUI

/// Owns all navigation state and is the only place that builds screens (BLUEPRINT §7.4, D-026, D-032).
///
/// `path` and `sheet` are written only by the private `push`, `present`, `dismissPresented` and `pop(to:)`.
/// The system's Back button and back-swipe reach `pop(to:)` through the path binding; a swipe-down on the
/// sheet reaches `dismissPresented()` through the sheet binding.
@MainActor @Observable final class AppCoordinator {
    private(set) var path: [Route] = []
    private(set) var sheet: Sheet?

    @ObservationIgnored private let dependencies: AppDependencies

    init(dependencies: AppDependencies) {
        self.dependencies = dependencies
    }

    /// The one public view entry, hosted by `SceneDelegate`: Home inside the navigation shell, with the theme injected.
    func rootView() -> some View {
        CoordinatorView(
            path: pathBinding,
            sheet: sheetBinding,
            theme: dependencies.theme,
            root: { self.makeHome() },
            destination: { self.makeDestination(for: $0) },
            sheetContent: { self.makeSheet(for: $0) }
        )
    }

    // MARK: - Writing navigation state (private)

    private func push(_ route: Route) {
        path.append(route)
    }

    private func present(_ newSheet: Sheet) {
        sheet = newSheet
    }

    private func dismissPresented() {
        sheet = nil
    }

    /// Shortens the stack to `depth` screens above Home. Anything else is ignored.
    private func pop(to depth: Int) {
        guard depth >= 0, depth < path.count else { return }
        path.removeLast(path.count - depth)
    }

    private var pathBinding: Binding<[Route]> {
        Binding(
            get: { self.path },
            set: { newPath in
                // The system only ever shortens the path (Back button, back-swipe).
                guard newPath.count < self.path.count, Array(self.path.prefix(newPath.count)) == newPath else { return }
                self.pop(to: newPath.count)
            }
        )
    }

    private var sheetBinding: Binding<Sheet?> {
        Binding(
            get: { self.sheet },
            set: { newSheet in
                // The system only ever clears the sheet (swipe down).
                if newSheet == nil {
                    self.dismissPresented()
                }
            }
        )
    }

    // MARK: - Screens (private factories)

    private func makeHome() -> some View {
        // Phase 1 placeholder: the real Home (HomeView + HomeViewModel) lands in phase 2.
        HomePlaceholderView()
    }

    @ViewBuilder
    private func makeDestination(for route: Route) -> some View {
        // Phase 1: Category, Search results and Product detail land in phase 2, each from its own factory.
        switch route {
        case .category, .product, .searchResults:
            EmptyView()
        }
    }

    @ViewBuilder
    private func makeSheet(for sheet: Sheet) -> some View {
        // Phase 1: the enquiry sheet lands in phase 2.
        switch sheet {
        case .enquiry:
            EmptyView()
        }
    }
}

// MARK: - Navigators: thin entry points, each forwarding to one private function

extension AppCoordinator: HomeNavigating, CategoryNavigating, SearchResultsNavigating, ProductDetailNavigating, EnquiryNavigating {
    func showProduct(id: Int) {
        push(.product(id: id))
    }

    func showCategory(name: String) {
        push(.category(name: name))
    }

    func showSearchResults(query: String) {
        push(.searchResults(query: query))
    }

    func showEnquiry(productId: Int, productTitle: String) {
        present(.enquiry(productId: productId, productTitle: productTitle))
    }

    func dismissSheet() {
        dismissPresented()
    }
}

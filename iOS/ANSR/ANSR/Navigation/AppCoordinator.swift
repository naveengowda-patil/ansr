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

    /// Internal, not private, so tests can shorten the path the way the system does. Its setter can only pop.
    var pathBinding: Binding<[Route]> {
        Binding(
            get: { self.path },
            set: { newPath in
                // The system only ever shortens the path (Back button, back-swipe).
                guard newPath.count < self.path.count, Array(self.path.prefix(newPath.count)) == newPath else { return }
                self.pop(to: newPath.count)
            }
        )
    }

    /// Internal, not private, so tests can clear the sheet the way the system does. Its setter can only dismiss.
    var sheetBinding: Binding<Sheet?> {
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
        HomeView(viewModel: HomeViewModel(
            productRepository: dependencies.productRepository,
            categoryRepository: dependencies.categoryRepository,
            imageProvider: dependencies.imageProvider,
            navigator: self,
            locale: dependencies.locale
        ))
    }

    @ViewBuilder
    private func makeDestination(for route: Route) -> some View {
        // Placeholders until Category, Product detail and Search results land, each from its own factory.
        switch route {
        case .category(let name):
            RoutePlaceholderView(title: Strings.placeholderCategory(name: name))
        case .product(let id):
            RoutePlaceholderView(title: Strings.placeholderProduct(id: id))
        case .searchResults(let query):
            RoutePlaceholderView(title: Strings.placeholderSearch(query: query))
        }
    }

    @ViewBuilder
    private func makeSheet(for sheet: Sheet) -> some View {
        // Placeholder until the enquiry sheet lands.
        switch sheet {
        case .enquiry(let productId, _):
            RoutePlaceholderView(title: Strings.placeholderEnquiry(productId: productId))
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

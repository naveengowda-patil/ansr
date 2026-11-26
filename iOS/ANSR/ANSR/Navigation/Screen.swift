import Foundation

/// What a route builds (BLUEPRINT §7.4): the screen's view model. `AppCoordinator.screen(for:)` returns it,
/// so tests can check what a route builds without inspecting SwiftUI types.
enum Screen {
    case category(CategoryViewModel)
    case searchResults(SearchResultsViewModel)
    case productDetail(ProductDetailViewModel)
}

import SwiftUI
import Testing
@testable import ANSR

/// `AppCoordinator` navigation (BLUEPRINT §9.2): entry points push the right `Route`, and the system's Back goes through pop.
@MainActor
@Suite("AppCoordinator")
struct AppCoordinatorTests {
    private let coordinator = AppCoordinator(dependencies: .mock)

    @Test("showProduct, showCategory and showSearchResults push the right Route")
    func entryPointsPushRoutes() {
        coordinator.showProduct(id: 5)
        coordinator.showCategory(name: "jewelery")
        coordinator.showSearchResults(query: "ring")

        #expect(coordinator.path == [.product(id: 5), .category(name: "jewelery"), .searchResults(query: "ring")])
    }

    @Test("Two searches push two screens")
    func twoSearchesPushTwoScreens() {
        coordinator.showSearchResults(query: "ring")
        coordinator.showSearchResults(query: "bag")

        #expect(coordinator.path == [.searchResults(query: "ring"), .searchResults(query: "bag")])
    }

    @Test("A shorter path from the binding (Back button or back-swipe) pops")
    func bindingShorterPathPops() {
        coordinator.showCategory(name: "jewelery")
        coordinator.showProduct(id: 5)

        coordinator.pathBinding.wrappedValue = [.category(name: "jewelery")]
        #expect(coordinator.path == [.category(name: "jewelery")])

        coordinator.pathBinding.wrappedValue = []
        #expect(coordinator.path.isEmpty)
    }

    @Test("The binding can't push or replace screens: only the coordinator's entry points do")
    func bindingCannotPushOrReplace() {
        coordinator.showProduct(id: 5)

        coordinator.pathBinding.wrappedValue = [.product(id: 5), .product(id: 6)]
        coordinator.pathBinding.wrappedValue = [.category(name: "jewelery")]

        #expect(coordinator.path == [.product(id: 5)])
    }

    @Test("The category route builds the Category screen for that name, with the coordinator as its navigator")
    func categoryRouteBuildsCategoryScreen() async {
        guard case .category(let viewModel) = coordinator.screen(for: .category(name: "jewelery")) else {
            Issue.record("Expected the Category screen")
            return
        }
        #expect(viewModel.navigationTitle == "Jewelery")

        await viewModel.load()
        guard case .loaded(let data) = viewModel.state else {
            Issue.record("Expected the mock jewelery category to load, got \(viewModel.state)")
            return
        }
        #expect(data.title == "Jewelery")

        viewModel.didTapProduct(id: 5)
        #expect(coordinator.path == [.product(id: 5)])
    }

    @Test("Routes without a screen yet show a placeholder naming them")
    func otherRoutesArePlaceholders() {
        guard case .placeholder(let title) = coordinator.screen(for: .product(id: 5)) else {
            Issue.record("Expected a placeholder")
            return
        }
        #expect(title == "Product 5")
    }

    @Test("showEnquiry presents the sheet, and dismissSheet or a swipe-down clears it")
    func sheetPresentsAndDismisses() {
        coordinator.showEnquiry(productId: 5, productTitle: "Bracelet")
        #expect(coordinator.sheet == .enquiry(productId: 5, productTitle: "Bracelet"))

        coordinator.dismissSheet()
        #expect(coordinator.sheet == nil)

        coordinator.showEnquiry(productId: 5, productTitle: "Bracelet")
        coordinator.sheetBinding.wrappedValue = nil
        #expect(coordinator.sheet == nil)
    }
}

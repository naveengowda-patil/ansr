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

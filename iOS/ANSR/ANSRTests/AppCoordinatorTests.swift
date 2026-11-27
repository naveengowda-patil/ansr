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

    @Test("The search results route builds the Search results screen for that query, with the coordinator as its navigator")
    func searchResultsRouteBuildsSearchResultsScreen() async {
        guard case .searchResults(let viewModel) = coordinator.screen(for: .searchResults(query: "bracelet")) else {
            Issue.record("Expected the Search results screen")
            return
        }
        #expect(viewModel.query == "bracelet")
        #expect(viewModel.searchText == "bracelet")

        await viewModel.load()
        guard case .loaded(let data) = viewModel.state else {
            Issue.record("Expected the mock search to find the bracelet, got \(viewModel.state)")
            return
        }
        #expect(data.results.map(\.id) == [5])

        viewModel.isSearchActive = true
        viewModel.searchText = "ring"
        viewModel.didSubmitSearch()
        #expect(coordinator.path == [.searchResults(query: "ring")])
    }

    @Test("The product route builds the Product detail screen for that id; Enquire sets the sheet and a swipe-down clears it")
    func productRouteBuildsDetailScreen() async {
        guard case .productDetail(let viewModel) = coordinator.screen(for: .product(id: 5)) else {
            Issue.record("Expected the Product detail screen")
            return
        }
        #expect(viewModel.productId == 5)

        await viewModel.load()
        guard case .loaded(let product) = viewModel.state else {
            Issue.record("Expected the mock product 5 to load, got \(viewModel.state)")
            return
        }

        viewModel.didTapEnquire()
        #expect(coordinator.sheet == .enquiry(productId: 5, productTitle: product.title))

        coordinator.sheetBinding.wrappedValue = nil
        #expect(coordinator.sheet == nil)
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

    @Test("The enquiry sheet builds the Enquiry screen for that product, with the coordinator as its navigator")
    func enquirySheetBuildsEnquiryScreen() {
        coordinator.showEnquiry(productId: 3, productTitle: "Mens Cotton Jacket")
        guard let sheet = coordinator.sheet, case .enquiry(let viewModel) = coordinator.sheetScreen(for: sheet) else {
            Issue.record("Expected the Enquiry screen")
            return
        }
        #expect(viewModel.productId == 3)
        #expect(viewModel.productTitle == "Mens Cotton Jacket")

        viewModel.didTapCancel()
        #expect(coordinator.sheet == nil)
    }
}

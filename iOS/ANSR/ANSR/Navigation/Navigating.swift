import Foundation

// One navigator protocol per view model, with only the moves it may make (BLUEPRINT §7.4, D-032).
// `AppCoordinator` conforms to all five; view models hold theirs `weak`.

@MainActor protocol HomeNavigating: AnyObject {
    func showProduct(id: Int)
    func showCategory(name: String)
    func showSearchResults(query: String)
}

@MainActor protocol CategoryNavigating: AnyObject {
    func showProduct(id: Int)
}

@MainActor protocol SearchResultsNavigating: AnyObject {
    func showProduct(id: Int)
    func showSearchResults(query: String)
}

@MainActor protocol ProductDetailNavigating: AnyObject {
    func showEnquiry(productId: Int, productTitle: String)
}

@MainActor protocol EnquiryNavigating: AnyObject {
    func dismissSheet()
}

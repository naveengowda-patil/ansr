import UIKit
@testable import ANSR

/// Product repository test double: returns the configured result, counts calls, and can hold the next `featured()` call.
actor StubProductRepository: ProductRepository {
    private var featuredResult: Result<[Product], APIError>
    private var featuredHold: Hold?
    private(set) var featuredCallCount = 0

    init(featured: Result<[Product], APIError> = .success([])) {
        self.featuredResult = featured
    }

    func setFeatured(_ result: Result<[Product], APIError>) { featuredResult = result }
    /// Holds only the next call to `featured()`; later calls go straight through.
    func holdFeatured(_ hold: Hold?) { featuredHold = hold }

    func featured() async throws(APIError) -> [Product] {
        featuredCallCount += 1
        if let hold = featuredHold {
            featuredHold = nil
            await hold.wait()
        }
        return try featuredResult.get()
    }

    func search(_ query: ProductQuery) async throws(APIError) -> ProductPage {
        ProductPage(items: [], total: 0, page: 1, pageSize: 20)
    }

    func product(id: Int) async throws(APIError) -> Product {
        throw .notFound
    }
}

/// Category repository test double: returns the configured results, records calls, and can hold the next `category(_:)` call.
actor StubCategoryRepository: CategoryRepository {
    private var categoriesResult: Result<[String], APIError>
    private var categoryResult: Result<CategoryProducts, APIError>
    private var categoryHold: Hold?
    private(set) var categoriesCallCount = 0
    private(set) var requestedCategories: [String] = []

    init(
        categories: Result<[String], APIError> = .success([]),
        category: Result<CategoryProducts, APIError> = .failure(.notFound)
    ) {
        self.categoriesResult = categories
        self.categoryResult = category
    }

    func setCategories(_ result: Result<[String], APIError>) { categoriesResult = result }
    func setCategory(_ result: Result<CategoryProducts, APIError>) { categoryResult = result }
    /// Holds only the next call to `category(_:)`; later calls go straight through.
    func holdCategory(_ hold: Hold?) { categoryHold = hold }

    func categories() async throws(APIError) -> [String] {
        categoriesCallCount += 1
        return try categoriesResult.get()
    }

    func category(_ name: String) async throws(APIError) -> CategoryProducts {
        requestedCategories.append(name)
        if let hold = categoryHold {
            categoryHold = nil
            await hold.wait()
        }
        return try categoryResult.get()
    }
}

/// Image provider test double: never touches the network or disk.
struct StubImageProvider: ImageProvider {
    func image(forProductId id: Int) async throws -> UIImage {
        UIImage()
    }
}

/// Records every Home navigation call, in order.
@MainActor
final class RecordingHomeNavigator: HomeNavigating {
    enum Call: Equatable {
        case product(id: Int)
        case category(name: String)
        case searchResults(query: String)
    }

    private(set) var calls: [Call] = []

    func showProduct(id: Int) { calls.append(.product(id: id)) }
    func showCategory(name: String) { calls.append(.category(name: name)) }
    func showSearchResults(query: String) { calls.append(.searchResults(query: query)) }
}

/// Records every Category navigation call, in order.
@MainActor
final class RecordingCategoryNavigator: CategoryNavigating {
    private(set) var shownProducts: [Int] = []

    func showProduct(id: Int) { shownProducts.append(id) }
}

/// Products shaped like the backend's (BLUEPRINT §6.1).
enum Fixtures {
    static func product(id: Int, title: String, price: String, rate: Double, count: Int, category: String = "jewelery") -> Product {
        Product(
            id: id,
            title: title,
            description: "Description \(id)",
            category: category,
            price: Decimal(string: price) ?? 0,
            currency: "USD",
            rating: Rating(rate: rate, count: count)
        )
    }

    /// The five featured products, in API order.
    static let featured: [Product] = [
        product(id: 1, title: "Backpack", price: "109.95", rate: 3.9, count: 120, category: "men's clothing"),
        product(id: 5, title: "Bracelet", price: "695", rate: 4.6, count: 400),
        product(id: 9, title: "Hard Drive", price: "64", rate: 3.3, count: 203, category: "electronics"),
        product(id: 13, title: "Monitor", price: "599", rate: 2.9, count: 250, category: "electronics"),
        product(id: 17, title: "Rain Jacket", price: "39.99", rate: 3.8, count: 679, category: "women's clothing"),
    ]

    static let categories = ["men's clothing", "jewelery", "electronics", "women's clothing"]

    /// `GET /categories/jewelery`: the top 3 by rating, then the rest, each in API order.
    static let jewelery = CategoryProducts(
        category: "jewelery",
        topRated: [
            product(id: 5, title: "Bracelet", price: "695", rate: 4.6, count: 400),
            product(id: 7, title: "Princess Ring", price: "9.99", rate: 3, count: 400),
            product(id: 8, title: "Earrings", price: "10.99", rate: 1.9, count: 100),
        ],
        rest: [
            product(id: 6, title: "Micropave", price: "168", rate: 3.9, count: 70),
        ]
    )
}

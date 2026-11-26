#if DEBUG
import UIKit

/// Mock repositories and image provider for previews (BLUEPRINT §7.7, D-014). Debug builds only.
struct MockProductRepository: ProductRepository {
    func featured() async throws(APIError) -> [Product] {
        MockData.products
    }

    func search(_ query: ProductQuery) async throws(APIError) -> ProductPage {
        let term = (query.q ?? "").lowercased()
        let items = MockData.products.filter { term.isEmpty || $0.title.lowercased().contains(term) }
        return ProductPage(items: items, total: items.count, page: 1, pageSize: 20)
    }

    func product(id: Int) async throws(APIError) -> Product {
        guard let product = MockData.products.first(where: { $0.id == id }) else { throw .notFound }
        return product
    }
}

struct MockCategoryRepository: CategoryRepository {
    func categories() async throws(APIError) -> [String] {
        MockData.categories
    }

    func category(_ name: String) async throws(APIError) -> CategoryProducts {
        let products = MockData.products.filter { $0.category.caseInsensitiveCompare(name) == .orderedSame }
        guard let first = products.first else { throw .notFound }
        return CategoryProducts(category: first.category, topRated: Array(products.prefix(3)), rest: Array(products.dropFirst(3)))
    }
}

struct MockEnquiryRepository: EnquiryRepository {
    func submit(_ enquiry: EnquiryRequest) async throws(APIError) -> EnquiryResponse {
        EnquiryResponse(status: "sent")
    }
}

struct MockImageProvider: ImageProvider {
    func image(forProductId id: Int) async throws -> UIImage {
        guard let image = UIImage(systemName: "bag") else { throw ImageProviderError.undecodableImage }
        return image
    }
}

extension AppDependencies {
    /// For previews: real view models with mock repositories.
    static var mock: AppDependencies {
        AppDependencies(
            productRepository: MockProductRepository(),
            categoryRepository: MockCategoryRepository(),
            enquiryRepository: MockEnquiryRepository(),
            imageProvider: MockImageProvider(),
            theme: .standard,
            locale: Locale(identifier: "en_US")
        )
    }
}
#endif

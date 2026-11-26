import Foundation

/// Products: featured, search and detail (BLUEPRINT §7.10).
protocol ProductRepository: Sendable {
    func featured() async throws(APIError) -> [Product]
    func search(_ query: ProductQuery) async throws(APIError) -> ProductPage
    func product(id: Int) async throws(APIError) -> Product
}

/// `ProductRepository` backed by our API. One endpoint per method, no cache, no UI state.
struct RemoteProductRepository: ProductRepository {
    private let client: any NetworkClient

    init(client: any NetworkClient) {
        self.client = client
    }

    func featured() async throws(APIError) -> [Product] {
        try await client.send(Endpoints.featured, as: ItemsResponse<Product>.self).items
    }

    func search(_ query: ProductQuery) async throws(APIError) -> ProductPage {
        try await client.send(Endpoints.products(query), as: ProductPage.self)
    }

    func product(id: Int) async throws(APIError) -> Product {
        try await client.send(Endpoints.product(id: id), as: Product.self)
    }
}

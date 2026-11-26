import Foundation

/// Categories: the list and one category's products (BLUEPRINT §7.10).
protocol CategoryRepository: Sendable {
    func categories() async throws(APIError) -> [String]
    func category(_ name: String) async throws(APIError) -> CategoryProducts
}

/// `CategoryRepository` backed by our API. One endpoint per method, no cache, no UI state.
struct RemoteCategoryRepository: CategoryRepository {
    private let client: any NetworkClient

    init(client: any NetworkClient) {
        self.client = client
    }

    func categories() async throws(APIError) -> [String] {
        try await client.send(Endpoints.categories, as: ItemsResponse<String>.self).items
    }

    func category(_ name: String) async throws(APIError) -> CategoryProducts {
        try await client.send(Endpoints.category(name: name), as: CategoryProducts.self)
    }
}

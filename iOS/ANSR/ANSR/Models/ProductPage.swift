import Foundation

/// One page of `GET /products` (BLUEPRINT §6.4, AC-3).
struct ProductPage: Decodable, Sendable, Equatable {
    let items: [Product]
    let total: Int
    let page: Int
    let pageSize: Int
}

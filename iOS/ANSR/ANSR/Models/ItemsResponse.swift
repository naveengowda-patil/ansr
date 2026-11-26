import Foundation

/// The `{ "items": [...] }` wrapper used by `GET /products/featured` and `GET /categories` (BLUEPRINT §6.3, §6.7).
struct ItemsResponse<Item: Decodable & Sendable>: Decodable, Sendable {
    let items: [Item]
}

extension ItemsResponse: Equatable where Item: Equatable {}

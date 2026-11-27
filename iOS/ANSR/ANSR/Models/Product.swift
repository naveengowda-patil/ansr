import Foundation

/// A product as the backend returns it (BLUEPRINT §6.1). There is no image URL: images come from `Endpoints.productImage(id:)`.
struct Product: Codable, Sendable, Equatable, Identifiable {
    let id: Int
    let title: String
    let description: String
    let category: String
    let price: Decimal
    let currency: String
    let rating: Rating
}

/// A product's rating (BLUEPRINT §6.1).
struct Rating: Codable, Sendable, Equatable {
    let rate: Double
    let count: Int
}

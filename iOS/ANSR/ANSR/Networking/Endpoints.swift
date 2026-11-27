import Foundation

/// Every backend request the app makes (BLUEPRINT §6, §7.5). Nothing here sends an empty value.
enum Endpoints {
    /// `GET /products/featured` (AC-1).
    static let featured = Endpoint(pathSegments: ["products", "featured"])

    /// `GET /categories`.
    static let categories = Endpoint(pathSegments: ["categories"])

    /// `GET /products` with only the non-empty query fields (AC-3).
    static func products(_ query: ProductQuery) -> Endpoint {
        Endpoint(
            pathSegments: ["products"],
            query: [
                ("q", query.q),
                ("category", query.category),
                ("minPrice", query.minPrice.map { "\($0)" }),
                ("maxPrice", query.maxPrice.map { "\($0)" }),
                ("minRating", query.minRating.map { "\($0)" }),
                ("sort", query.sort?.rawValue),
                ("page", query.page.map { "\($0)" }),
                ("pageSize", query.pageSize.map { "\($0)" }),
            ]
        )
    }

    /// `GET /products/{id}` (AC-4).
    static func product(id: Int) -> Endpoint {
        Endpoint(pathSegments: ["products", String(id)])
    }

    /// `GET /products/{id}/image`.
    static func productImage(id: Int) -> Endpoint {
        Endpoint(pathSegments: ["products", String(id), "image"])
    }

    /// `GET /categories/{category}`, path-encoded (AC-2).
    static func category(name: String) -> Endpoint {
        Endpoint(pathSegments: ["categories", name])
    }

    /// `POST /enquiries` (AC-5). A blank `message` is left out of the body.
    static func createEnquiry(_ enquiry: EnquiryRequest) -> Endpoint {
        let message = enquiry.message.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 }
        return Endpoint(
            method: .post,
            pathSegments: ["enquiries"],
            body: EnquiryBody(productId: enquiry.productId, name: enquiry.name, email: enquiry.email, message: message)
        )
    }
}

/// The JSON body of `POST /enquiries`. A `nil` message is omitted, never sent as `null` or `""`.
private struct EnquiryBody: Encodable, Sendable {
    let productId: Int
    let name: String
    let email: String
    let message: String?
}

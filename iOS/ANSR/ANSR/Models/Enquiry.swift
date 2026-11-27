import Foundation

/// The body of `POST /enquiries` (BLUEPRINT §6.9, AC-5). `productId` is a Swift `Int`, so it is always encoded as a JSON number.
/// The view model trims `name` and `email`; `Endpoints.createEnquiry(_:)` omits a blank `message`.
struct EnquiryRequest: Sendable, Equatable {
    let productId: Int
    let name: String
    let email: String
    let message: String?
}

/// The reply to `POST /enquiries`: `{ "status": "sent" }`.
struct EnquiryResponse: Decodable, Sendable, Equatable {
    let status: String
}

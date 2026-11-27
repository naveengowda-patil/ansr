import Foundation

/// Sends a product enquiry (BLUEPRINT §7.10, AC-5).
protocol EnquiryRepository: Sendable {
    func submit(_ enquiry: EnquiryRequest) async throws(APIError) -> EnquiryResponse
}

/// `EnquiryRepository` backed by our API.
struct RemoteEnquiryRepository: EnquiryRepository {
    private let client: any NetworkClient

    init(client: any NetworkClient) {
        self.client = client
    }

    func submit(_ enquiry: EnquiryRequest) async throws(APIError) -> EnquiryResponse {
        try await client.send(Endpoints.createEnquiry(enquiry), as: EnquiryResponse.self)
    }
}

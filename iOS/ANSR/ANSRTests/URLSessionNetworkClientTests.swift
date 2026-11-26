import Foundation
import Testing
@testable import ANSR

/// `URLSessionNetworkClient` + `Endpoints` (BLUEPRINT §9.2, AC-3 and every call): only non-empty params are sent,
/// and every failure maps to the right `APIError`.
@Suite("URLSessionNetworkClient")
struct URLSessionNetworkClientTests {
    private static let emptyPage = Data(#"{"items":[],"total":0,"page":1,"pageSize":20}"#.utf8)

    private static func envelope(_ code: String) -> Data {
        Data(#"{"error":{"code":"\#(code)","message":"Safe message."}}"#.utf8)
    }

    /// Runs a search and returns the one request the stub received.
    private func sentRequest(for query: ProductQuery) async throws -> URLRequest {
        let (client, stub) = URLSessionNetworkClient.stubbed(.response(status: 200, body: Self.emptyPage))
        _ = try await client.send(Endpoints.products(query), as: ProductPage.self)
        return try #require(stub.requests.first)
    }

    // MARK: - Search sends only non-empty params (AC-3)

    @Test("A search term is trimmed and sent as the only param")
    func searchSendsTrimmedTermOnly() async throws {
        let request = try await sentRequest(for: ProductQuery(q: " bag "))
        let url = try #require(request.url)
        #expect(url.path() == "/products")
        #expect(url.query() == "q=bag")
    }

    @Test("A blank or missing search term is left out", arguments: [nil, "", "   ", "\n\t"] as [String?])
    func blankTermIsOmitted(term: String?) async throws {
        let request = try await sentRequest(for: ProductQuery(q: term))
        let url = try #require(request.url)
        #expect(url.path() == "/products")
        #expect(url.query() == nil)
    }

    @Test("nil fields are never sent, not even as empty values")
    func nilFieldsAreOmitted() async throws {
        let request = try await sentRequest(for: ProductQuery(q: "bag", category: "  "))
        let url = try #require(request.url)
        let items = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
        #expect(items == [URLQueryItem(name: "q", value: "bag")])
    }

    @Test("Characters a server reads as separators are percent-encoded in the term")
    func termIsEncoded() async throws {
        let request = try await sentRequest(for: ProductQuery(q: "c++ & more"))
        #expect(request.url?.query() == "q=c%2B%2B%20%26%20more")
    }

    // MARK: - The error envelope maps to the right APIError

    @Test("Each status and envelope code maps to its APIError", arguments: [
        (400, ErrorEnvelope.Code.validation, APIError.validation(message: "Safe message.")),
        (404, ErrorEnvelope.Code.notFound, APIError.notFound),
        (502, ErrorEnvelope.Code.upstream, APIError.upstream),
        (500, ErrorEnvelope.Code.internalError, APIError.server(status: 500)),
    ])
    func envelopeMapsToError(status: Int, code: String, expected: APIError) async {
        let (client, _) = URLSessionNetworkClient.stubbed(.response(status: status, body: Self.envelope(code)))
        await #expect(throws: expected) {
            try await client.send(Endpoints.featured, as: ItemsResponse<Product>.self)
        }
    }

    @Test("A non-2xx status with an unknown body is a server error", arguments: [400, 404, 500, 502, 503])
    func unknownBodyIsServerError(status: Int) async {
        let (client, _) = URLSessionNetworkClient.stubbed(.response(status: status, body: Data("<html>Bad gateway</html>".utf8)))
        await #expect(throws: APIError.server(status: status)) {
            try await client.send(Endpoints.featured, as: ItemsResponse<Product>.self)
        }
    }

    @Test("A 2xx body that doesn't decode is a decoding error")
    func undecodableBodyIsDecodingError() async {
        let (client, _) = URLSessionNetworkClient.stubbed(.response(status: 200, body: Data(#"{"unexpected":true}"#.utf8)))
        await #expect(throws: APIError.decoding) {
            try await client.send(Endpoints.featured, as: ItemsResponse<Product>.self)
        }
    }

    @Test("Transport failures map to offline, timeout, cancelled or transport", arguments: [
        (URLError.Code.notConnectedToInternet, APIError.offline),
        (URLError.Code.networkConnectionLost, APIError.offline),
        (URLError.Code.timedOut, APIError.timeout),
        (URLError.Code.cancelled, APIError.cancelled),
        (URLError.Code.cannotFindHost, APIError.transport),
    ])
    func transportFailureMaps(code: URLError.Code, expected: APIError) async {
        let (client, _) = URLSessionNetworkClient.stubbed(.failure(code))
        await #expect(throws: expected) {
            try await client.data(for: Endpoints.productImage(id: 1))
        }
    }

    // MARK: - The enquiry body (AC-5) never carries an empty value

    @Test("The enquiry sends productId as a JSON number and leaves out a blank message")
    func enquiryBodyOmitsBlankMessage() async throws {
        let (client, stub) = URLSessionNetworkClient.stubbed(.response(status: 200, body: Data(#"{"status":"sent"}"#.utf8)))
        let enquiry = EnquiryRequest(productId: 7, name: "Ada", email: "ada@example.com", message: "  \n ")
        _ = try await client.send(Endpoints.createEnquiry(enquiry), as: EnquiryResponse.self)

        let request = try #require(stub.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path() == "/enquiries")
        let body = try #require(request.bodyStreamData ?? request.httpBody)
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(Set(json.keys) == ["productId", "name", "email"])
        #expect((json["productId"] as? NSNumber)?.intValue == 7)
        #expect(json["productId"] is NSNumber)
    }
}

private extension URLRequest {
    /// `URLSession` hands a `URLProtocol` the body as a stream, so read it back from there.
    var bodyStreamData: Data? {
        guard let stream = httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 1024)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count > 0 else { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

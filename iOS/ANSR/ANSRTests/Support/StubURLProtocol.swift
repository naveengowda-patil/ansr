import Foundation
import Synchronization
@testable import ANSR

/// A `URLProtocol` that answers requests from a registered stub instead of the network (BLUEPRINT §9.2).
///
/// Each test registers its stub under its own host, so tests can run in parallel without sharing a reply.
final class StubURLProtocol: URLProtocol {
    enum Reply: Sendable {
        case response(status: Int, body: Data)
        case failure(URLError.Code)
    }

    /// One registered stub: the reply, plus the requests it received.
    final class Stub: Sendable {
        let reply: Reply
        private let received = Mutex<[URLRequest]>([])

        init(reply: Reply) {
            self.reply = reply
        }

        var requests: [URLRequest] { received.withLock { $0 } }

        fileprivate func record(_ request: URLRequest) {
            received.withLock { $0.append(request) }
        }
    }

    private static let stubs = Mutex<[String: Stub]>([:])

    /// Registers `reply` for a fresh host and returns that host and the stub.
    static func register(_ reply: Reply) -> (host: String, stub: Stub) {
        let host = "stub-\(UUID().uuidString.lowercased()).test"
        let stub = Stub(reply: reply)
        stubs.withLock { $0[host] = stub }
        return (host, stub)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url, let host = url.host(),
              let stub = Self.stubs.withLock({ $0[host] }) else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        stub.record(request)
        switch stub.reply {
        case .response(let status, let body):
            guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil) else {
                client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
                return
            }
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body)
            client?.urlProtocolDidFinishLoading(self)
        case .failure(let code):
            client?.urlProtocol(self, didFailWithError: URLError(code))
        }
    }

    override func stopLoading() {}
}

extension URLSessionNetworkClient {
    /// A client whose every request is answered by `reply`, plus the stub that records what was sent.
    static func stubbed(_ reply: StubURLProtocol.Reply) -> (client: URLSessionNetworkClient, stub: StubURLProtocol.Stub) {
        let (host, stub) = StubURLProtocol.register(reply)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        configuration.urlCache = nil
        var components = URLComponents()
        components.scheme = "http"
        components.host = host
        guard let baseURL = components.url else { preconditionFailure("Invalid stub host \(host)") }
        return (URLSessionNetworkClient(session: URLSession(configuration: configuration), baseURL: baseURL), stub)
    }
}

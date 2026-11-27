import Foundation

/// The state of a screen that loads data (BLUEPRINT §7.11). There is no idle state: screens start in `.loading`.
enum ViewState<Value> {
    case loading
    case loaded(Value)
    case empty
    case error(message: String)
}

extension ViewState: Equatable where Value: Equatable {}
extension ViewState: Sendable where Value: Sendable {}

import SwiftUI

/// The Search results screen (BLUEPRINT §7.8.3): the results line, then a 2-column grid of exactly the returned products.
/// A dumb view: it renders `SearchResultsViewModel.state` and calls intents. Layout polish is phase 3.
struct SearchResultsView: View {
    @State private var viewModel: SearchResultsViewModel
    @Environment(\.theme) private var theme

    init(viewModel: SearchResultsViewModel) {
        _viewModel = State(initialValue: viewModel)
    }

    var body: some View {
        StateContainerView(
            state: viewModel.state,
            emptyMessage: viewModel.emptyMessage,
            retry: { Task { await viewModel.retry() } }
        ) { data in
            ScrollView {
                VStack(alignment: .leading, spacing: theme.spacing.large) {
                    Text(data.summary)
                        .font(theme.fonts.subheadline)
                        .foregroundStyle(theme.colors.secondaryText)
                    ProductTileGrid(
                        tiles: data.results,
                        imageState: viewModel.imageState(for:),
                        tileAppeared: viewModel.tileAppeared(id:),
                        tileTapped: viewModel.didTapProduct(id:)
                    )
                }
                .padding(theme.spacing.large)
            }
        }
        .background(theme.colors.background)
        .navigationTitle(viewModel.query)
        .navigationBarTitleDisplayMode(.inline)
        .productSearchField(text: $viewModel.searchText, isPresented: $viewModel.isSearchActive, onSubmit: viewModel.didSubmitSearch)
        .onAppear(perform: viewModel.screenAppeared)
        .task { await viewModel.load() }
    }
}

#if DEBUG
#Preview {
    let dependencies = AppDependencies.mock
    let coordinator = AppCoordinator(dependencies: dependencies)
    NavigationStack {
        SearchResultsView(viewModel: SearchResultsViewModel(
            query: "bracelet",
            productRepository: dependencies.productRepository,
            imageProvider: dependencies.imageProvider,
            navigator: coordinator,
            locale: dependencies.locale
        ))
    }
}
#endif

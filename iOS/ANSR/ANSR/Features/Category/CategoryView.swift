import SwiftUI

/// The Category screen (BLUEPRINT §7.8.2): "Top rated" as a row, then "More in {Category}" as a 2-column grid.
/// A dumb view: it renders `CategoryViewModel.state` and calls intents. Layout polish is phase 3.
struct CategoryView: View {
    @State private var viewModel: CategoryViewModel
    @Environment(\.theme) private var theme

    init(viewModel: CategoryViewModel) {
        _viewModel = State(initialValue: viewModel)
    }

    var body: some View {
        StateContainerView(
            state: viewModel.state,
            emptyMessage: Strings.categoryNotFound,
            retry: { Task { await viewModel.retry() } }
        ) { data in
            ScrollView {
                VStack(alignment: .leading, spacing: theme.spacing.large) {
                    if !data.topRated.isEmpty {
                        sectionTitle(Strings.categoryTopRated)
                        ProductTileRow(
                            tiles: data.topRated,
                            imageState: viewModel.imageState(for:),
                            tileAppeared: viewModel.tileAppeared(id:),
                            tileTapped: viewModel.didTapProduct(id:)
                        )
                    }
                    if !data.rest.isEmpty {
                        sectionTitle(data.moreTitle)
                        ProductTileGrid(
                            tiles: data.rest,
                            imageState: viewModel.imageState(for:),
                            tileAppeared: viewModel.tileAppeared(id:),
                            tileTapped: viewModel.didTapProduct(id:)
                        )
                    }
                }
                .padding(theme.spacing.large)
            }
        }
        .background(theme.colors.background)
        .navigationTitle(viewModel.navigationTitle)
        .navigationBarTitleDisplayMode(.large)
        .task { await viewModel.load() }
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text)
            .font(theme.fonts.headline)
            .foregroundStyle(theme.colors.primaryText)
    }
}

#if DEBUG
#Preview {
    let dependencies = AppDependencies.mock
    let coordinator = AppCoordinator(dependencies: dependencies)
    NavigationStack {
        CategoryView(viewModel: CategoryViewModel(
            name: "jewelery",
            categoryRepository: dependencies.categoryRepository,
            imageProvider: dependencies.imageProvider,
            navigator: coordinator,
            locale: dependencies.locale
        ))
    }
}
#endif

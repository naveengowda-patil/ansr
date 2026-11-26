import SwiftUI

/// Home (BLUEPRINT §7.8.1): the featured products, the categories and the search field.
/// A dumb view: it renders `HomeViewModel.state` and calls intents. Layout polish is phase 3.
struct HomeView: View {
    @State private var viewModel: HomeViewModel
    @Environment(\.theme) private var theme

    init(viewModel: HomeViewModel) {
        _viewModel = State(initialValue: viewModel)
    }

    var body: some View {
        StateContainerView(
            state: viewModel.state,
            emptyMessage: Strings.homeEmpty,
            retry: { Task { await viewModel.retry() } }
        ) { data in
            List {
                if !data.featured.isEmpty {
                    Section(Strings.homeTopRated) {
                        featuredRow(data.featured)
                    }
                }
                if !data.categories.isEmpty {
                    Section(Strings.homeCategories) {
                        ForEach(data.categories) { category in
                            categoryRow(category)
                        }
                    }
                }
            }
        }
        .background(theme.colors.background)
        .navigationTitle(Strings.homeTitle)
        .navigationBarTitleDisplayMode(.large)
        .searchable(
            text: $viewModel.searchText,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: Strings.searchPrompt
        )
        .onSubmit(of: .search) { viewModel.didSubmitSearch() }
        .task { await viewModel.load() }
    }

    private func featuredRow(_ tiles: [ProductTileViewData]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: theme.spacing.medium) {
                ForEach(tiles) { tile in
                    Button {
                        viewModel.didTapProduct(id: tile.id)
                    } label: {
                        ProductTileView(
                            data: tile,
                            imageState: viewModel.imageState(for: tile.id),
                            onAppear: { await viewModel.tileAppeared(id: tile.id) }
                        )
                        .frame(width: theme.imageSizes.tileWidth)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, theme.spacing.small)
        }
        .listRowInsets(EdgeInsets(top: 0, leading: theme.spacing.large, bottom: 0, trailing: theme.spacing.large))
    }

    private func categoryRow(_ category: CategoryRowViewData) -> some View {
        Button {
            viewModel.didTapCategory(name: category.name)
        } label: {
            HStack {
                Text(category.title)
                    .font(theme.fonts.body)
                    .foregroundStyle(theme.colors.primaryText)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(theme.fonts.caption)
                    .foregroundStyle(theme.colors.secondaryText)
            }
        }
    }
}

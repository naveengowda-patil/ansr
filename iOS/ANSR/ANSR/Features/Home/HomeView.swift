import SwiftUI

/// Home (BLUEPRINT §7.8.1): the featured products, the categories and the search field.
/// A dumb view: it renders `HomeViewModel.state` and calls intents. The list shows the theme's background, so loading,
/// error and loaded share one background, and the "Top rated" row sits on it with no cell around it (§7.11).
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
            .scrollContentBackground(.hidden)
        }
        .background(theme.colors.background)
        .navigationTitle(Strings.homeTitle)
        .navigationBarTitleDisplayMode(.large)
        .productSearchField(text: $viewModel.searchText, isPresented: $viewModel.isSearchActive, onSubmit: viewModel.didSubmitSearch)
        .onAppear(perform: viewModel.screenAppeared)
        .task { await viewModel.load() }
    }

    private func featuredRow(_ tiles: [ProductTileViewData]) -> some View {
        ProductTileRow(
            tiles: tiles,
            imageState: viewModel.imageState(for:),
            tileAppeared: viewModel.tileAppeared(id:),
            tileTapped: viewModel.didTapProduct(id:)
        )
        .listRowInsets(EdgeInsets())
        .listRowBackground(Color.clear)
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

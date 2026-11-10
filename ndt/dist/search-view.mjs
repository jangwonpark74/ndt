export function bindSearchView({form, query, panel, status, list}, viewModel, map) {
  const submit = form.querySelector('button[type="submit"]');
  viewModel.subscribe(state => {
    if (query.value !== state.query) query.value = state.query;
    submit.disabled = state.loading;
    panel.hidden = !state.open;
    status.textContent = state.status;
    list.replaceChildren();
    for (const result of state.results) {
      const item = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.textContent = result.label;
      button.onclick = () => { viewModel.select(result); map.flyTo({center:result.coordinates, zoom:15, pitch:55}); };
      item.append(button); list.append(item);
    }
  });
  form.onsubmit = event => {
    event.preventDefault();
    if (!query.value.trim()) { query.focus(); return; }
    viewModel.submit(map.getCenter());
  };
  query.oninput = () => viewModel.setQuery(query.value);
  form.onkeydown = event => { if (event.key === 'Escape') { viewModel.dismiss(); query.focus(); } };
  viewModel.setQuery(query.value);
}

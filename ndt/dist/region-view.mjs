export function showRegionError() {
  const loading = document.getElementById('loading'), error = document.getElementById('error');
  loading.hidden = true; error.hidden = false;
  error.querySelector('p').textContent = 'The regional data service is unavailable. Start the viewer with make run.';
  document.getElementById('retry').onclick = () => location.reload();
}

export function renderRegionView(viewModel) {
  const $ = id => document.getElementById(id);
  const {regions,region} = viewModel.getState(), choices = $('region-choices');
  for (const item of regions) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = item.name;
    button.setAttribute('aria-label',`${item.name} region`); button.setAttribute('aria-pressed',String(item.id === region.id));
    button.onclick = () => { const url = viewModel.regionUrl(item.id,location.href); if (url) location.assign(url); };
    choices.append(button);
  }
  document.title = `Samsung CongitV NDT · ${region.name} in 3D`;
  $('map').setAttribute('aria-label',`Interactive 3D map of ${region.name}`);
  $('reset').setAttribute('aria-label',`Reset camera to ${region.name} overview`);
  $('reset').title = `Reset camera to ${region.name} overview`;
  for (const project of region.projects) {
    const option = document.createElement('option'); option.value = project.id; option.textContent = project.name; $('project-picker').append(option);
  }
  if (region.network !== 'ised') {
    document.querySelector('.network-settings').hidden = true;
    $('nyc-network-settings').hidden = region.network !== 'nyc-poles';
    $('network-toggle').checked = false; $('bell-toggle').checked = false;
  }
}

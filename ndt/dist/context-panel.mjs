export function hideProjectOverview() {
  document.getElementById('project-overview').hidden = true;
  for (const element of document.querySelectorAll('#map,.map-controls,#location-search')) element.inert = false;
}

export function showProjectOverview() {
  document.getElementById('context-panel').hidden = true;
  document.dispatchEvent(new CustomEvent('contextchange',{detail:null}));
  const overview = document.getElementById('project-overview'); overview.hidden = false;
  for (const element of document.querySelectorAll('#map,.map-controls,#location-search')) element.inert = true;
  overview.focus({preventScroll:true});
}

export function openContextPanel(id) {
  hideProjectOverview();
  document.getElementById('context-panel').hidden = false;
  document.getElementById('context-panel').scrollTop = 0;
  for (const panel of document.querySelectorAll('.context-panel')) panel.hidden = panel.id !== id;
  const project = id === 'task-panel', ue = id === 'ue-panel';
  if (project || ue) {document.getElementById('project-tab').disabled = false; document.getElementById('ue-tab').disabled = false;}
  document.getElementById('project-tab').setAttribute('aria-pressed',String(project));
  document.getElementById('ue-tab').setAttribute('aria-pressed',String(ue));
  document.getElementById('network-tab').setAttribute('aria-pressed',String(!project && !ue));
  const label = project ? 'Close project tasks' : ue ? 'Close virtual UE editor' : id === 'nyc-panel' ? 'Close Verizon reservations' : 'Close network view';
  document.getElementById('context-close').setAttribute('aria-label',label);
  document.getElementById('context-close').title = label;
  document.dispatchEvent(new CustomEvent('contextchange',{detail:id}));
}

export function hideContextPanel(id) {
  const panel = document.getElementById(id);
  if (!panel.hidden) document.getElementById('context-panel').hidden = true;
  panel.hidden = true;
}

export function closeContextPanel() {
  document.getElementById('context-panel').hidden = true;
  for (const panel of document.querySelectorAll('.context-panel')) panel.hidden = true;
  document.dispatchEvent(new CustomEvent('contextchange',{detail:null}));
  document.querySelector('.network-settings').open = false;
  document.getElementById('nyc-network-settings').open = false;
  const project = document.getElementById('active-project'), toggle = document.getElementById('navigation-toggle');
  const target = !project.hidden ? project : toggle.offsetParent ? toggle : document.querySelector('#map-navigation .map-settings:not([hidden]) summary');
  target.focus();
}

export function bindContextPanel(networkPanel) {
  document.getElementById('project-tab').onclick = () => openContextPanel('task-panel');
  document.getElementById('ue-tab').onclick = () => openContextPanel('ue-panel');
  const network = document.getElementById('network-tab');
  network.setAttribute('aria-controls',networkPanel);
  network.onclick = () => openContextPanel(networkPanel);
  document.getElementById('context-close').onclick = closeContextPanel;
  document.getElementById('context-panel').addEventListener('keydown',event=>{
    if (event.key === 'Escape') {event.stopPropagation(); closeContextPanel();}
  });
}

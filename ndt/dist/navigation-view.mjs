export function bindNavigationView(viewModel) {
  const nav = document.getElementById('map-navigation'), toggle = document.getElementById('navigation-toggle');
  const mobile = matchMedia('(max-width: 700px)');
  viewModel.subscribe(({open})=>{
    nav.classList.toggle('navigation-open',open && mobile.matches);
    toggle.setAttribute('aria-expanded',String(open && mobile.matches));
    toggle.setAttribute('aria-label',open && mobile.matches ? 'Close map navigation' : 'Open map navigation');
  });
  toggle.onclick = () => viewModel.setOpen(!viewModel.getState().open);
  document.getElementById('overview-open').addEventListener('click',()=>viewModel.setOpen(false));
  mobile.addEventListener('change',()=>{
    const restoreFocus = mobile.matches && nav.contains(document.activeElement);
    viewModel.setOpen(false);
    if (restoreFocus) toggle.focus();
  });
  document.addEventListener('keydown',event=>{
    if (event.key === 'Escape' && mobile.matches && viewModel.getState().open) {viewModel.setOpen(false); toggle.focus();}
  });
  document.addEventListener('pointerdown',event=>{
    if (mobile.matches && viewModel.getState().open && !nav.contains(event.target) && !toggle.contains(event.target)) viewModel.setOpen(false);
  });
  nav.addEventListener('change',event=>{
    if (mobile.matches && event.target.id === 'project-picker') {viewModel.setOpen(false); toggle.focus();}
  });
}

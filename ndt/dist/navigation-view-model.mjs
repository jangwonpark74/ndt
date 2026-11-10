export function createNavigationViewModel() {
  let open = false;
  const listeners = new Set();
  return {
    getState: () => ({open}),
    subscribe(listener) {listeners.add(listener); listener({open}); return () => listeners.delete(listener);},
    setOpen(value) {open = Boolean(value); for (const listener of listeners) listener({open});},
  };
}

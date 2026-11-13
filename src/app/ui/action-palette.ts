/** A persistent, nonmodal action panel. The controller owns command routing. */
export interface ActionPalette {
  el: HTMLElement;
  show(): void;
  hide(): void;
  toggle(): void;
  isOpen(): boolean;
  destroy(): void;
}

const ACTIONS = [
  { id: 'wait', label: 'Wait', path: 'M8 3h8M8 21h8M8 3v4l4 5-4 5v4M16 3v4l-4 5 4 5v4' },
  { id: 'search', label: 'Search', path: 'M15 15l6 6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0' },
  { id: 'rest', label: 'Rest', path: 'M3 5v15M21 11v9M3 17h18M3 10h5v5H3M8 11h10a3 3 0 0 1 3 3v3' },
  { id: 'fire', label: 'Fire', path: 'M4 20L20 4M12 4h8v8M3 15l6 6M5 12l7 7' },
  { id: 'interact', label: 'Interact', path: 'M4 4h16v12H10l-6 5V4M8 9h8M8 12h5' },
  { id: 'disarm', label: 'Disarm', path: 'M7 13L18 3M17 13L6 3M9 17a3 3 0 1 1-6 0 3 3 0 0 1 6 0M21 17a3 3 0 1 1-6 0 3 3 0 0 1 6 0' },
  { id: 'journal', label: 'Journal', path: 'M12 5v16M3 4h5l4 2 4-2h5v15h-5l-4 2-4-2H3V4M6 8h3M15 8h3M6 12h3M15 12h3' },
] as const;

function icon(pathData: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', pathData);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

export function createActionPalette(options: { onAction: (id: string) => void }): ActionPalette {
  const el = document.createElement('section');
  el.className = 'action-palette';
  el.setAttribute('aria-label', 'Actions');
  el.hidden = true;
  const heading = document.createElement('div');
  heading.className = 'action-palette-heading';
  const title = document.createElement('span');
  title.textContent = 'Actions';
  const close = document.createElement('button');
  close.type = 'button';
  close.dataset.paletteClose = '';
  close.setAttribute('aria-label', 'Close actions');
  close.title = 'Close actions';
  close.append(icon('M6 6l12 12M18 6L6 18'));
  heading.append(title, close);
  const grid = document.createElement('div');
  grid.className = 'action-palette-grid';
  for (const action of ACTIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = action.id;
    button.setAttribute('aria-label', action.label);
    const label = document.createElement('span');
    label.textContent = action.label;
    button.append(icon(action.path), label);
    grid.append(button);
  }
  el.append(heading, grid);
  let destroyed = false;
  const setOpen = (open: boolean): void => {
    if (destroyed || el.hidden === !open) return;
    el.hidden = !open;
    // The dock listens to this to keep aria-expanded in sync, including Close.
    el.dispatchEvent(new Event('toggle', { bubbles: true }));
  };
  const onClick = (event: MouseEvent): void => {
    if (el.hidden || destroyed || !(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('button');
    if (!button || !el.contains(button)) return;
    if (button.hasAttribute('data-palette-close')) setOpen(false);
    else if (button.dataset.action) options.onAction(button.dataset.action);
  };
  el.addEventListener('click', onClick);
  return {
    el,
    show: () => setOpen(true),
    hide: () => setOpen(false),
    toggle: () => setOpen(el.hidden),
    isOpen: () => !el.hidden,
    destroy: () => {
      setOpen(false);
      destroyed = true;
      el.removeEventListener('click', onClick);
      el.remove();
    },
  };
}

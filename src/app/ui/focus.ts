/** Shared focus ownership for full-screen views and stacked dialogs. */
interface FocusScope {
  root: HTMLElement;
  previous: HTMLElement | null;
  initial?: HTMLElement;
}

const scopes: FocusScope[] = [];
const inertBefore = new Map<HTMLElement, boolean>();
let observer: MutationObserver | null = null;

function available(el: HTMLElement): boolean {
  if (el.tabIndex < 0 || el.matches(':disabled') || !el.isConnected) return false;
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (node.hidden || node.hasAttribute('inert')) return false;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (node instanceof HTMLDetailsElement && !node.open) {
      const summary = node.querySelector(':scope > summary');
      if (!summary?.contains(el)) return false;
    }
  }
  return true;
}

/** Read visibility from styles rather than geometry so headless DOM tests work. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, summary, [tabindex]',
  )].filter(available);
}

function activeScope(): FocusScope | undefined {
  return scopes[scopes.length - 1];
}

function focusFirst(scope: FocusScope): void {
  const initial = scope.initial;
  (initial && available(initial) ? initial : focusableIn(scope.root)[0] ?? scope.root)
    .focus({ preventScroll: true });
}

function syncInert(): void {
  for (const [element, wasInert] of inertBefore) element.toggleAttribute('inert', wasInert);
  inertBefore.clear();
  const scope = activeScope();
  if (!scope) return;
  // A scope can live inside #app. Only its ancestor path stays interactive.
  for (let node: HTMLElement | null = scope.root; node?.parentElement; node = node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling === node || !(sibling instanceof HTMLElement)) continue;
      inertBefore.set(sibling, sibling.hasAttribute('inert'));
      sibling.setAttribute('inert', '');
    }
    if (node.parentElement === document.body) break;
  }
}

function release(scope: FocusScope): void {
  const index = scopes.indexOf(scope);
  if (index < 0) return;
  const wasTop = scope === activeScope();
  scopes.splice(index, 1);
  syncInert();
  if (wasTop) {
    const next = activeScope();
    if (scope.previous?.isConnected && available(scope.previous)
      && (!next || next.root.contains(scope.previous))) {
      scope.previous.focus({ preventScroll: true });
    } else if (next) focusFirst(next);
  }
  if (!scopes.length) {
    observer?.disconnect();
    observer = null;
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('focusin', onFocus);
  }
}

function prune(): void {
  for (const scope of [...scopes].reverse()) if (!scope.root.isConnected) release(scope);
}

function onKeydown(event: KeyboardEvent): void {
  prune();
  const scope = activeScope();
  if (!scope || event.key !== 'Tab') return;
  const candidates = focusableIn(scope.root);
  const first = candidates[0];
  const last = candidates[candidates.length - 1];
  const active = document.activeElement;
  if (!first || !last) {
    event.preventDefault();
    scope.root.focus();
  } else if (event.shiftKey && (active === first || !scope.root.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !scope.root.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

function onFocus(event: FocusEvent): void {
  const scope = activeScope();
  if (scope && !scope.root.contains(event.target as Node)) focusFirst(scope);
}

/**
 * Own keyboard focus until release or DOM removal. Later scopes temporarily
 * suspend earlier scopes, so a modal can open above a title or story screen.
 */
export function ownFocus(root: HTMLElement, initial?: HTMLElement): () => void {
  prune();
  const scope: FocusScope = {
    root, initial,
    previous: document.activeElement instanceof HTMLElement ? document.activeElement : null,
  };
  if (!root.hasAttribute('tabindex')) root.tabIndex = -1;
  scopes.push(scope);
  syncInert();
  if (!observer) {
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('focusin', onFocus);
    observer = new MutationObserver(() => {
      prune();
      syncInert();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  focusFirst(scope);
  return () => release(scope);
}

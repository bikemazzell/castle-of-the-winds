import { openModal } from './dialogs';
import type { EditorTab } from '../editor/ui';

export function openDebugDialog(options: {
  revealMap: boolean;
  onReveal: (enabled: boolean) => void;
  onEdit: (tab: EditorTab) => void;
}): void {
  const content = document.createElement('div');
  content.className = 'debug-menu menu-list';
  const label = document.createElement('label');
  label.className = 'debug-toggle';
  const reveal = document.createElement('input');
  reveal.type = 'checkbox';
  reveal.dataset.field = 'debug-reveal';
  reveal.checked = options.revealMap;
  reveal.addEventListener('change', () => options.onReveal(reveal.checked));
  label.append(reveal, 'Show full map');
  const note = document.createElement('p');
  note.className = 'editor-note';
  note.textContent = 'Show all terrain and actors on the current level. This view lasts until you reload the page. Exploration and combat rules stay the same.';
  content.append(label, note);
  const handle = openModal({title: 'Debug', content});
  const entries: [EditorTab, string][] = [
    ['character', 'Character stats, health, mana, and spells'],
    ['inventory', 'Items and gold'],
    ['position', 'Position and explored map'],
    ['world', 'World seed'],
  ];
  for (const [tab, title] of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = title;
    button.dataset.debugEdit = tab;
    button.addEventListener('click', () => { handle.close(); options.onEdit(tab); });
    content.append(button);
  }
  const saveNote = document.createElement('p');
  saveNote.className = 'editor-note';
  saveNote.textContent = 'Apply edits to the running game, then save to keep them.';
  content.append(saveNote);
}

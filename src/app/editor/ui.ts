/**
 * Save-editor dialog (Task 6.2 UI).
 *
 * Four tabs over the running save: Character / Inventory / Position / World.
 * The dialog only *collects* edits; every Apply funnels the whole batch through
 * the transactional `applyEdits` core (validate → clone → edit → revalidate),
 * so a failed batch leaves both the on-screen save and the stored file intact.
 */
import type { Difficulty, Gender } from '../../engine/types';
import type { SaveFile } from '../../engine/save';
import type { WorldData } from '../../engine/types';
import { openModal, type ModalHandle } from '../ui/dialogs';
import { applyEdits, type SaveEdits } from './editor';

export interface EditorDialogOptions {
  initialTab?: EditorTab;
  title?: string;
  save: SaveFile;
  data: WorldData;
  onApply: (save: SaveFile) => void;
}

interface PendingAdd {
  defId: string;
  count: number;
}

export type EditorTab = 'character' | 'inventory' | 'position' | 'world';

const TABS: Array<{ id: string; label: string }> = [
  { id: 'character', label: 'Character' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'position', label: 'Position' },
  { id: 'world', label: 'World' },
];

/**
 * Map an applyEdits failure to the dialog field that owns it, so the message
 * can be explained *beside* the affected control (UI plan Phase 7). Fields use
 * the dialog's data-field names; null = footer-only.
 */
export function fieldForError(error: string): string | null {
  if (/^name must/.test(error)) return 'name';
  if (/^unknown gender/.test(error)) return 'gender';
  if (/^unknown difficulty/.test(error)) return 'difficulty';
  if (/^strength\b/.test(error)) return 'str';
  if (/^intelligence\b/.test(error)) return 'int';
  if (/^constitution\b/.test(error)) return 'con';
  if (/^dexterity\b/.test(error)) return 'dex';
  if (/^level must be an integer/.test(error)) return 'level';
  if (/^experience\b/.test(error)) return 'xp';
  if (/^hp must/.test(error)) return 'hp';
  if (/^mana must/.test(error)) return 'mana';
  if (/^gold must/.test(error)) return 'gold';
  if (/knownSpells|unknown spell id/.test(error)) return 'spells';
  if (/^worldSeed|^seed /.test(error)) return 'seed';
  if (/^x must|is not walkable|is occupied on level/.test(error)) return 'pos-x';
  if (/^y must/.test(error)) return 'pos-y';
  if (/^level must be between|^level \d+ has no free/.test(error)) return 'pos-level';
  if (/add count for|unknown item definition|too heavy|carry limit/.test(error)) return 'item-search';
  return null;
}

function numberInput(
  doc: Document,
  field: string,
  value: number,
  opts: { min?: number; max?: number } = {},
): HTMLInputElement {
  const input = doc.createElement('input');
  input.type = 'number';
  input.dataset.field = field;
  input.value = String(value);
  if (opts.min !== undefined) input.min = String(opts.min);
  if (opts.max !== undefined) input.max = String(opts.max);
  return input;
}

function labeledRow(doc: Document, label: string, input: HTMLElement): HTMLElement {
  const row = doc.createElement('label');
  row.className = 'editor-row';
  const span = doc.createElement('span');
  span.textContent = label;
  row.append(span, input);
  return row;
}

export function openEditorDialog(options: EditorDialogOptions): void {
  const { save, data, onApply } = options;
  const doc = document;

  let pendingAdds: PendingAdd[] = [];
  let removedUids: string[] = [];

  const content = doc.createElement('div');
  content.className = 'editor-dialog';

  // ---- Tabs ----
  const tabBar = doc.createElement('div');
  tabBar.className = 'editor-tabs';
  const panels: Record<string, HTMLElement> = {};
  const tabButtons: Record<string, HTMLButtonElement> = {};
  for (const tab of TABS) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.textContent = tab.label;
    btn.dataset.tab = tab.id;
    btn.className = 'editor-tab';
    btn.addEventListener('click', () => {
      for (const other of TABS) {
        const active = other.id === tab.id;
        tabButtons[other.id]!.classList.toggle('active', active);
        panels[other.id]!.classList.toggle('active', active);
      }
    });
    tabBar.appendChild(btn);
    tabButtons[tab.id] = btn;
    const panel = doc.createElement('div');
    panel.dataset.panel = tab.id;
    panel.className = 'editor-panel';
    panels[tab.id] = panel;
  }
  const initialTab = options.initialTab ?? 'character';
  tabButtons[initialTab]!.classList.add('active');
  panels[initialTab]!.classList.add('active');
  content.appendChild(tabBar);
  for (const tab of TABS) content.appendChild(panels[tab.id]!);

  // ---- Character panel ----
  const p = save.player;
  const nameInput = doc.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 24;
  nameInput.dataset.field = 'name';
  nameInput.value = p.name;
  panels.character!.appendChild(labeledRow(doc, 'Name', nameInput));

  const genderSel = doc.createElement('select');
  genderSel.dataset.field = 'gender';
  for (const g of ['female', 'male'] as Gender[]) {
    const opt = doc.createElement('option');
    opt.value = g;
    opt.textContent = g === 'female' ? 'Female' : 'Male';
    opt.selected = g === p.gender;
    genderSel.appendChild(opt);
  }
  panels.character!.appendChild(labeledRow(doc, 'Gender', genderSel));

  const statInputs: Record<string, HTMLInputElement> = {};
  for (const [field, value] of [
    ['str', p.strength],
    ['int', p.intelligence],
    ['con', p.constitution],
    ['dex', p.dexterity],
  ] as const) {
    const input = numberInput(doc, field, value, { min: 1, max: 100 });
    statInputs[field] = input;
    panels.character!.appendChild(labeledRow(doc, field.toUpperCase(), input));
  }

  const levelInput = numberInput(doc, 'level', p.level, { min: 1, max: 99 });
  panels.character!.appendChild(labeledRow(doc, 'Level', levelInput));
  const xpInput = numberInput(doc, 'xp', p.experience, { min: 0 });
  panels.character!.appendChild(labeledRow(doc, 'Experience', xpInput));
  const hpInput = numberInput(doc, 'hp', p.hp, { min: 1 });
  panels.character!.appendChild(labeledRow(doc, 'HP', hpInput));
  const manaInput = numberInput(doc, 'mana', p.mana, { min: 0 });
  panels.character!.appendChild(labeledRow(doc, 'Mana', manaInput));
  const goldInput = numberInput(doc, 'gold', save.inventory.gold, { min: 0 });
  panels.inventory!.appendChild(labeledRow(doc, 'Gold', goldInput));

  const diffSel = doc.createElement('select');
  diffSel.dataset.field = 'difficulty';
  for (const d of ['easy', 'intermediate', 'difficult', 'expert'] as Difficulty[]) {
    const opt = doc.createElement('option');
    opt.value = d;
    opt.textContent = d[0]!.toUpperCase() + d.slice(1);
    opt.selected = d === p.difficulty;
    diffSel.appendChild(opt);
  }
  panels.character!.appendChild(labeledRow(doc, 'Difficulty', diffSel));

  const keepRatio = doc.createElement('input');
  keepRatio.type = 'checkbox';
  keepRatio.dataset.field = 'keep-ratio';
  keepRatio.checked = true;
  panels.character!.appendChild(labeledRow(doc, 'Keep hp/mana ratio when caps change', keepRatio));

  const spellsInput = doc.createElement('input');
  spellsInput.type = 'text';
  spellsInput.dataset.field = 'spells';
  spellsInput.placeholder = 'spell ids, comma-separated (e.g. s527, s512)';
  spellsInput.value = save.player.knownSpells.join(', ');
  panels.character!.appendChild(labeledRow(doc, 'Known spells', spellsInput));

  // ---- Inventory panel ----
  const invNote = doc.createElement('p');
  invNote.className = 'editor-note';
  invNote.textContent = 'Add from the catalog, or remove from the pack below. Equipment is read-only — unequip in game first.';
  panels.inventory!.appendChild(invNote);

  const searchInput = doc.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Search items…';
  searchInput.dataset.field = 'item-search';
  panels.inventory!.appendChild(searchInput);

  const catalog = doc.createElement('div');
  catalog.className = 'item-catalog';
  panels.inventory!.appendChild(catalog);

  const pendingList = doc.createElement('div');
  pendingList.className = 'pending-adds';
  panels.inventory!.appendChild(pendingList);

  const packList = doc.createElement('div');
  packList.className = 'pack-list';
  panels.inventory!.appendChild(packList);

  const itemDefs = Object.values(data.items).sort((a, b) => a.name.localeCompare(b.name));
  const renderCatalog = (): void => {
    catalog.replaceChildren();
    const needle = searchInput.value.trim().toLowerCase();
    for (const def of itemDefs) {
      if (needle && !def.name.toLowerCase().includes(needle)) continue;
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'catalog-item';
      btn.dataset.addId = def.id;
      btn.textContent = def.name;
      btn.addEventListener('click', () => {
        const existing = pendingAdds.find((a) => a.defId === def.id);
        if (existing) existing.count += 1;
        else pendingAdds.push({ defId: def.id, count: 1 });
        markEdits();
        renderPending();
      });
      catalog.appendChild(btn);
    }
  };
  searchInput.addEventListener('input', renderCatalog);

  const renderPending = (): void => {
    pendingList.replaceChildren();
    if (!pendingAdds.length) return;
    const head = doc.createElement('p');
    head.className = 'editor-note';
    head.textContent = 'To be added:';
    pendingList.appendChild(head);
    for (const add of pendingAdds) {
      const def = data.items[add.defId];
      const row = doc.createElement('div');
      row.className = 'inv-row';
      row.dataset.pending = add.defId;
      const label = doc.createElement('span');
      label.textContent = def ? def.name : add.defId;
      const count = numberInput(doc, `count-${add.defId}`, add.count, { min: 1, max: 99 });
      count.addEventListener('input', () => {
        const n = Number(count.value);
        if (Number.isFinite(n) && n >= 1) add.count = Math.floor(n);
      });
      const rm = doc.createElement('button');
      rm.type = 'button';
      rm.textContent = '×';
      rm.dataset.action = 'remove-pending';
      rm.addEventListener('click', () => {
        pendingAdds = pendingAdds.filter((a) => a !== add);
        markEdits();
        renderPending();
      });
      row.append(label, count, rm);
      pendingList.appendChild(row);
    }
  };

  const renderPack = (): void => {
    packList.replaceChildren();
    for (const item of save.inventory.pack) {
      const def = data.items[item.defId];
      const row = doc.createElement('div');
      row.className = 'inv-row';
      row.dataset.uid = item.uid;
      const label = doc.createElement('span');
      label.textContent = `${def ? def.name : item.defId}${item.count > 1 ? ` ×${item.count}` : ''}`;
      const rm = doc.createElement('button');
      rm.type = 'button';
      rm.textContent = removedUids.includes(item.uid) ? 'Undo remove' : 'Remove';
      rm.dataset.removeUid = item.uid;
      rm.addEventListener('click', () => {
        if (removedUids.includes(item.uid)) {
          removedUids = removedUids.filter((u) => u !== item.uid);
        } else {
          removedUids.push(item.uid);
        }
        markEdits();
        row.classList.toggle('removed', removedUids.includes(item.uid));
        rm.textContent = removedUids.includes(item.uid) ? 'Undo remove' : 'Remove';
      });
      row.append(label, rm);
      packList.appendChild(row);
    }
    const equipped = Object.entries(save.inventory.equipment);
    if (equipped.length) {
      const head = doc.createElement('p');
      head.className = 'editor-note';
      head.textContent = 'Equipped (read-only):';
      packList.appendChild(head);
      for (const [slot, item] of equipped) {
        const def = data.items[item.defId];
        const row = doc.createElement('div');
        row.className = 'inv-row equipped';
        const label = doc.createElement('span');
        label.textContent = `${slot}: ${def ? def.name : item.defId}`;
        row.appendChild(label);
        packList.appendChild(row);
      }
    }
  };
  renderCatalog();
  renderPack();

  // ---- Position panel ----
  const levelSel = doc.createElement('select');
  levelSel.dataset.field = 'pos-level';
  for (const node of data.levels) {
    const opt = doc.createElement('option');
    opt.value = String(node.index);
    opt.textContent = `${node.index} — ${node.name}`;
    opt.selected = node.index === save.world.current;
    levelSel.appendChild(opt);
  }
  panels.position!.appendChild(labeledRow(doc, 'Level', levelSel));

  const posNote = doc.createElement('p');
  posNote.className = 'editor-note';
  posNote.textContent = 'Leave x/y blank to land on a safe tile (stairs, or first free walkable).';
  panels.position!.appendChild(posNote);

  const xInput = numberInput(doc, 'pos-x', Number.NaN, { min: 0, max: 63 });
  xInput.value = '';
  const yInput = numberInput(doc, 'pos-y', Number.NaN, { min: 0, max: 63 });
  yInput.value = '';
  const xyRow = doc.createElement('div');
  xyRow.className = 'editor-row';
  xyRow.append(labeledRow(doc, 'x', xInput), labeledRow(doc, 'y', yInput));
  panels.position!.appendChild(xyRow);

  const genNote = doc.createElement('p');
  genNote.className = 'editor-note';
  genNote.dataset.field = 'gen-note';
  panels.position!.appendChild(genNote);
  const updateGenNote = (): void => {
    const target = levelSel.value;
    genNote.textContent = target in save.levels ? '' : 'Unvisited — the level will be generated from the world seed.';
  };
  levelSel.addEventListener('change', updateGenNote);
  updateGenNote();

  const reveal = doc.createElement('input');
  reveal.type = 'checkbox';
  reveal.dataset.field = 'reveal';
  panels.position!.appendChild(labeledRow(doc, 'Reveal map memory', reveal));

  // ---- World panel ----
  const seedWarn = doc.createElement('p');
  seedWarn.className = 'editor-note';
  seedWarn.textContent = 'Changing the seed discards all generated dungeon levels; they regenerate from the new seed. You return to town.';
  panels.world!.appendChild(seedWarn);
  const seedInput = numberInput(doc, 'seed', save.world.worldSeed, { min: 0 });
  panels.world!.appendChild(labeledRow(doc, 'World seed', seedInput));

  // ---- Footer ----
  const error = doc.createElement('p');
  error.dataset.field = 'editor-error';
  error.className = 'editor-error';
  const pendingNote = doc.createElement('p');
  pendingNote.dataset.field = 'pending-note';
  pendingNote.className = 'editor-note pending-note';
  const footer = doc.createElement('div');
  footer.className = 'editor-footer';
  const applyBtn = doc.createElement('button');
  applyBtn.type = 'button';
  applyBtn.textContent = 'Apply';
  applyBtn.dataset.action = 'apply-edits';
  const cancelBtn = doc.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.dataset.action = 'cancel-edits';
  footer.append(cancelBtn, applyBtn);
  content.append(pendingNote, error, footer);

  // ---- Pending-change tracking + discard confirmation (UI plan Phase 7) ----
  let hasEdits = false;
  const markEdits = (): void => {
    if (hasEdits) return;
    hasEdits = true;
    pendingNote.textContent = 'Unapplied changes — Apply to keep them, or Cancel to discard.';
  };
  for (const input of [nameInput, ...Object.values(statInputs), levelInput, xpInput, hpInput, manaInput, goldInput, spellsInput, xInput, yInput, seedInput]) {
    input.addEventListener('input', markEdits);
  }
  for (const sel of [genderSel, diffSel, levelSel]) sel.addEventListener('change', markEdits);
  keepRatio.addEventListener('change', markEdits);
  reveal.addEventListener('change', markEdits);

  const setFooterConfirm = (confirming: boolean): void => {
    footer.replaceChildren();
    if (!confirming) {
      cancelBtn.textContent = 'Cancel';
      cancelBtn.dataset.action = 'cancel-edits';
      footer.append(cancelBtn, applyBtn);
      return;
    }
    const keep = doc.createElement('button');
    keep.type = 'button';
    keep.textContent = 'Keep editing';
    keep.dataset.action = 'keep-editing';
    keep.addEventListener('click', () => setFooterConfirm(false));
    const discard = doc.createElement('button');
    discard.type = 'button';
    discard.textContent = 'Discard changes';
    discard.className = 'danger';
    discard.dataset.action = 'discard-edits';
    discard.addEventListener('click', () => handle.close());
    footer.append(keep, discard);
  };
  cancelBtn.addEventListener('click', () => {
    if (!hasEdits) handle.close();
    else setFooterConfirm(true);
  });

  const readNumber = (input: HTMLInputElement): number | undefined => {
    if (input.value.trim() === '') return undefined;
    const n = Number(input.value);
    return Number.isFinite(n) ? Math.floor(n) : undefined;
  };

  applyBtn.addEventListener('click', () => {
    error.textContent = '';
    clearFieldErrors();
    const sameLevel = Number(levelSel.value) === save.world.current;
    const positionChanged = !sameLevel || xInput.value.trim() !== '' || yInput.value.trim() !== '' || reveal.checked;
    const edits: SaveEdits = {
      character: {
        name: nameInput.value.trim() || undefined,
        gender: genderSel.value as Gender,
        strength: readNumber(statInputs.str!),
        intelligence: readNumber(statInputs.int!),
        constitution: readNumber(statInputs.con!),
        dexterity: readNumber(statInputs.dex!),
        level: readNumber(levelInput),
        experience: readNumber(xpInput),
        hp: readNumber(hpInput) === save.player.hp ? undefined : readNumber(hpInput),
        mana: readNumber(manaInput) === save.player.mana ? undefined : readNumber(manaInput),
        keepRatio: keepRatio.checked,
        difficulty: diffSel.value as Difficulty,
        ...((spellsInput.value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean).join(', ') !== save.player.knownSpells.join(', ')
          ? {
              knownSpells: spellsInput.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            }
          : {})),
      },
      inventory: {
        add: pendingAdds.length ? pendingAdds.map((a) => ({ defId: a.defId, count: a.count })) : undefined,
        remove: removedUids.length ? removedUids.map((uid) => ({ uid })) : undefined,
        gold: readNumber(goldInput),
      },
      position: positionChanged ? {
        level: Number(levelSel.value),
        x: readNumber(xInput) ?? (sameLevel ? save.player.x : undefined),
        y: readNumber(yInput) ?? (sameLevel ? save.player.y : undefined),
        revealMap: reveal.checked || undefined,
      } : undefined,
      worldSeed: readNumber(seedInput) === save.world.worldSeed ? undefined : readNumber(seedInput),
    };
    const result = applyEdits(save, edits, { data });
    if (result.ok) {
      onApply(result.save);
      handle.close();
    } else {
      error.textContent = result.error;
      showFieldError(result.error);
    }
  });

  /** Remove every inline field error (next Apply starts clean). */
  function clearFieldErrors(): void {
    for (const el of content.querySelectorAll('.field-error')) el.remove();
  }

  /** Explain a failure right beside the control that owns it. */
  function showFieldError(message: string): void {
    const field = fieldForError(message);
    if (!field) return;
    const input = content.querySelector(`[data-field="${field}"]`);
    const row = input?.closest('label') ?? input?.closest('.editor-row') ?? input?.parentElement;
    if (!row) return;
    const span = document.createElement('span');
    span.className = 'field-error';
    span.textContent = message;
    row.appendChild(span);
  }

  const handle: ModalHandle = openModal({
    title: options.title ?? 'Edit Save',
    content,
    className: 'wide',
  });
}

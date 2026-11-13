/**
 * Help browser (Task 5.4f): renders the extracted CASTLE1.HLP manual topics
 * with in-place navigation over the topic link graph and a Back stack.
 */
import { openModal, type ModalHandle } from './dialogs';

export interface HelpLink {
  to: number;
  topicNumber: number;
  kind: string;
}

export interface ManualTopic {
  id: number;
  topicNumber: number;
  title: string;
  body: string;
  links: HelpLink[];
}

export interface HelpDialogData {
  topics: ManualTopic[];
  initialId?: number;
}

export interface HelpBrowser {
  el: HTMLElement;
  navigate(topicId: number): void;
  back(): void;
}

export function buildHelpContent(data: HelpDialogData): HTMLElement {
  const byId = new Map<number, ManualTopic>(data.topics.map((t) => [t.id, t]));

  const el = document.createElement('div');
  el.className = 'help-dialog';

  const header = document.createElement('div');
  header.className = 'help-header';
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.textContent = '← Back';
  backBtn.dataset.action = 'help-back';
  const title = document.createElement('h3');
  title.dataset.field = 'help-title';
  header.append(backBtn, title);

  const body = document.createElement('div');
  body.className = 'help-body';
  body.dataset.field = 'help-body';

  const links = document.createElement('div');
  links.className = 'help-links';

  el.append(header, links, body);

  const history: number[] = [];
  let current = -1;

  function render(): void {
    const topic = byId.get(current);
    backBtn.disabled = history.length === 0;
    if (!topic) {
      title.textContent = 'Not found';
      body.replaceChildren();
      links.replaceChildren();
      return;
    }
    title.textContent = topic.title;
    const paras = topic.body
      .split('\n')
      .map((line) => line.trim())
      .filter((line, i, arr) => !(line === '' && (i === 0 || arr[i - 1] === '')))
      .map((line) => (line === '' ? null : line))
      .filter((line): line is string => line !== null)
      .map((line) => {
        const p = document.createElement('p');
        p.textContent = line;
        return p;
      });
    body.replaceChildren(...paras);

    const linkBtns = topic.links
      .map((link) => {
        const target = byId.get(link.to);
        if (!target) return null;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = target.title;
        btn.dataset.linkTo = String(link.to);
        btn.addEventListener('click', () => navigate(link.to));
        return btn;
      })
      .filter((b): b is HTMLButtonElement => b !== null);
    links.replaceChildren(...linkBtns);
  }

  function navigate(topicId: number): void {
    if (current === topicId) return;
    if (current >= 0) history.push(current);
    current = topicId;
    render();
  }

  function back(): void {
    const prev = history.pop();
    if (prev === undefined) return;
    current = prev;
    render();
  }

  backBtn.addEventListener('click', back);

  navigate(data.initialId ?? data.topics[0]?.id ?? 0);

  return el;
}

export function openHelpDialog(data: HelpDialogData): ModalHandle {
  return openModal({
    title: 'Help',
    content: buildHelpContent(data),
    className: 'dialog-help',
  });
}

export interface TabbedHelp {
  el: HTMLElement;
  /** Show one of the two tabs. */
  showTab(tab: 'modern' | 'manual'): void;
  /** Jump to a manual topic by topic number (switches to the manual tab). */
  openTopic(topicNumber: number): void;
}

const MODERN_CONTROLS: ReadonlyArray<{ label: string; items: string[] }> = [
  {
    label: 'Touch',
    items: [
      'Tap an explored tile to preview a route; tap it again to travel.',
      'Tap your own tile to interact — stairs, doors, and shops.',
      'Tap an adjacent tile for a single step; bump a monster to attack.',
      'Pinch, scroll, or use the map corner buttons to zoom; drag to pan.',
    ],
  },
  {
    label: 'Keyboard',
    items: [
      'Arrow keys, WASD, or numpad 2/4/6/8 move in four directions.',
      'Enter interacts with the tile you stand on.',
      'I Bag · C Spells · M Map · Esc Pause · . or 5 Wait.',
      'X Search · R Rest.',
    ],
  },
];

interface FaqEntry {
  q: string;
  a: string;
  /** Manual topic title to link for the deeper answer (omitted when absent). */
  manualTitle?: string;
}

const FAQ: ReadonlyArray<FaqEntry> = [
  {
    q: 'How do turns work?',
    a: 'Enemies act when you do. Every step, cast, or search is a turn — monsters take theirs after yours.',
    manualTitle: 'Overview of the Game',
  },
  {
    q: 'How do I save?',
    a: 'Pause (❚❚ or Esc) and choose Save / Load. Five slots plus an automatic save on stairs. You can export saves as files from the slot list.',
  },
  {
    q: 'How do I learn spells?',
    a: 'Read scrolls found in the dungeon — you learn the spell permanently. Mark favorites in the spellbook for the two quick slots.',
    manualTitle: 'Spells',
  },
  {
    q: 'How do I recover hit points and mana?',
    a: 'Rest from the Actions panel. Hit points return quickly; mana returns slowly — resting can be interrupted by monsters.',
    manualTitle: 'Resting',
  },
];

/**
 * Modern Help landing (UI plan Phase 7 task 3): opens on controls and common
 * questions, with the original manual as a separate tab. FAQ answers can deep
 * link into the manual browser.
 */
export function buildTabbedHelp(topics: ManualTopic[]): TabbedHelp {
  const byTitle = new Map(topics.map((t) => [t.title, t]));
  const byNumber = new Map(topics.map((t) => [t.topicNumber, t]));

  const el = document.createElement('div');
  el.className = 'help-tabs-root';

  const tabs = document.createElement('div');
  tabs.className = 'help-tabs';
  const modernBtn = document.createElement('button');
  modernBtn.type = 'button';
  modernBtn.dataset.htab = 'modern';
  modernBtn.textContent = 'How to play';
  const manualBtn = document.createElement('button');
  manualBtn.type = 'button';
  manualBtn.dataset.htab = 'manual';
  manualBtn.textContent = 'Original manual';
  tabs.append(modernBtn, manualBtn);

  const modernPanel = document.createElement('div');
  modernPanel.className = 'help-panel';
  modernPanel.dataset.panel = 'modern';

  const controlsHeader = document.createElement('h4');
  controlsHeader.textContent = 'Controls';
  modernPanel.appendChild(controlsHeader);
  for (const group of MODERN_CONTROLS) {
    const label = document.createElement('p');
    label.className = 'help-group-label';
    label.textContent = group.label;
    const list = document.createElement('ul');
    for (const item of group.items) {
      const li = document.createElement('li');
      li.textContent = item;
      list.appendChild(li);
    }
    modernPanel.append(label, list);
  }

  const faqHeader = document.createElement('h4');
  faqHeader.textContent = 'Common questions';
  modernPanel.appendChild(faqHeader);
  for (const item of FAQ) {
    const q = document.createElement('p');
    q.className = 'help-faq-q';
    q.textContent = item.q;
    const a = document.createElement('p');
    a.className = 'help-faq-a';
    a.textContent = item.a;
    modernPanel.append(q, a);
    if (item.manualTitle && byTitle.has(item.manualTitle)) {
      const topic = byTitle.get(item.manualTitle)!;
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'help-read-more';
      more.dataset.openTopic = String(topic.topicNumber);
      more.textContent = `Read more: ${topic.title}`;
      more.addEventListener('click', () => help.openTopic(topic.topicNumber));
      modernPanel.appendChild(more);
    }
  }

  const manualHost = document.createElement('div');
  manualHost.className = 'help-panel';
  manualHost.dataset.panel = 'manual';
  manualHost.appendChild(buildHelpContent({ topics }));

  el.append(tabs, modernPanel, manualHost);

  const help: TabbedHelp = {
    el,
    showTab(tab: 'modern' | 'manual'): void {
      modernBtn.classList.toggle('active', tab === 'modern');
      manualBtn.classList.toggle('active', tab === 'manual');
      modernPanel.classList.toggle('active', tab === 'modern');
      manualHost.classList.toggle('active', tab === 'manual');
    },
    openTopic(topicNumber: number): void {
      const topic = byNumber.get(topicNumber) ?? topics[0];
      manualHost.replaceChildren(
        buildHelpContent({ topics, initialId: topic ? topic.id : undefined }),
      );
      help.showTab('manual');
    },
  };

  modernBtn.addEventListener('click', () => help.showTab('modern'));
  manualBtn.addEventListener('click', () => help.showTab('manual'));
  help.showTab('modern');
  return help;
}

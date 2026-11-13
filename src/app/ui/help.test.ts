// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { ManualTopic } from './help';
import { buildHelpContent, buildTabbedHelp, openHelpDialog } from './help';
import { closeAllModals } from './dialogs';

function topics(): ManualTopic[] {
  return [
    {
      id: 0,
      topicNumber: 16,
      title: 'Index',
      body: 'Index\nOverview of the Game\nBackground',
      links: [
        { to: 1, topicNumber: 17, kind: 'topic' },
        { to: 2, topicNumber: 18, kind: 'topic' },
      ],
    },
    {
      id: 1,
      topicNumber: 17,
      title: 'Overview of the Game',
      body: 'Castle of the Winds is a two part graphical adventure game.',
      links: [],
    },
    {
      id: 2,
      topicNumber: 18,
      title: 'Background',
      body: 'Long ago in the land of Crossroads...',
      links: [],
    },
  ];
}

afterEach(() => {
  closeAllModals();
  document.body.innerHTML = '';
});

describe('help browser', () => {
  it('renders the initial topic title and body', () => {
    const el = buildHelpContent({ topics: topics(), initialId: 1 });
    expect(el.querySelector('[data-field="help-title"]')?.textContent).toBe('Overview of the Game');
    expect(el.querySelector('[data-field="help-body"]')?.textContent).toContain('two part graphical adventure game');
  });

  it('lists link buttons for topics the page points to', () => {
    const el = buildHelpContent({ topics: topics(), initialId: 0 });
    const links = el.querySelectorAll('[data-link-to]');
    expect(links.length).toBe(2);
    expect(links[0]?.textContent).toContain('Overview of the Game');
  });

  it('clicking a link navigates to that topic in place', () => {
    const el = buildHelpContent({ topics: topics(), initialId: 0 });
    (el.querySelector('[data-link-to="1"]') as HTMLButtonElement).click();
    expect(el.querySelector('[data-field="help-title"]')?.textContent).toBe('Overview of the Game');
    expect(el.querySelector('[data-link-to]')).toBeNull(); // this topic has no links
  });

  it('back button returns to the previous topic', () => {
    const el = buildHelpContent({ topics: topics(), initialId: 0 });
    (el.querySelector('[data-link-to="2"]') as HTMLButtonElement).click();
    expect(el.querySelector('[data-field="help-title"]')?.textContent).toBe('Background');
    (el.querySelector('[data-action="help-back"]') as HTMLButtonElement).click();
    expect(el.querySelector('[data-field="help-title"]')?.textContent).toBe('Index');
  });

  it('body paragraphs are rendered as separate elements', () => {
    const el = buildHelpContent({
      topics: [{ id: 9, topicNumber: 30, title: 'T', body: 'Line one\nLine two\n\nLine four', links: [] }],
      initialId: 9,
    });
    const paras = el.querySelectorAll('[data-field="help-body"] p');
    expect(paras.length).toBe(3); // blank line collapses
    expect(paras[1]?.textContent).toBe('Line two');
  });

  it('opens as a modal titled Help', () => {
    const modal = openHelpDialog({ topics: topics(), initialId: 0 });
    expect(modal.el.querySelector('.dialog-title')?.textContent).toContain('Help');
    expect(modal.el.querySelector('[data-field="help-title"]')?.textContent).toBe('Index');
  });
});

describe('tabbed help landing (UI plan Phase 7)', () => {
  it('opens on the modern tab with controls for touch and keyboard', () => {
    const help = buildTabbedHelp(topics());
    expect(help.el.querySelector('[data-htab="modern"]')?.textContent).toContain('How to play');
    expect(help.el.querySelector('[data-htab="manual"]')?.textContent).toContain('Original manual');
    expect(help.el.querySelector('[data-panel="modern"]')?.classList.contains('active')).toBe(true);
    const modernText = help.el.querySelector('[data-panel="modern"]')?.textContent ?? '';
    expect(modernText).toContain('Tap an explored tile');
    expect(modernText).toContain('Arrow keys');
  });

  it('switching to the manual tab shows the browser', () => {
    const help = buildTabbedHelp(topics());
    help.showTab('manual');
    const manual = help.el.querySelector('[data-panel="manual"]');
    expect(manual?.classList.contains('active')).toBe(true);
    expect(manual?.querySelector('[data-field="help-title"]')?.textContent).toBe('Index');
    expect(help.el.querySelector('[data-panel="modern"]')?.classList.contains('active')).toBe(false);
  });

  it('a FAQ answer can deep link into the manual', () => {
    const help = buildTabbedHelp(topics());
    const readMore = help.el.querySelector<HTMLButtonElement>('[data-open-topic]');
    // The fixture has 'Overview of the Game'; FAQ entries without a matching
    // topic render no button.
    expect(readMore?.textContent).toContain('Overview of the Game');
    readMore?.click();
    const manual = help.el.querySelector('[data-panel="manual"]');
    expect(manual?.classList.contains('active')).toBe(true);
    expect(manual?.querySelector('[data-field="help-title"]')?.textContent).toBe('Overview of the Game');
  });

  it('openTopic with an unknown number falls back to the index topic', () => {
    const help = buildTabbedHelp(topics());
    help.openTopic(9999);
    const manual = help.el.querySelector('[data-panel="manual"]');
    expect(manual?.querySelector('[data-field="help-title"]')?.textContent).toBe('Index');
  });
});

/**
 * @vitest-environment jsdom
 * Expanded log view (UI plan Phase 7 task 3): consecutive repeated messages
 * group with a count; the full log stays a plain readable list.
 */
import { describe, expect, it } from 'vitest';
import { buildLogList, groupLogEntries } from './logview';
import type { LogEntry } from '../../engine/types';

const entry = (turn: number, text: string): LogEntry => ({ turn, text });

describe('groupLogEntries (UI plan Phase 7)', () => {
  it('merges consecutive identical messages with a count and keeps the last turn', () => {
    const grouped = groupLogEntries([
      entry(1, 'The kobold misses you!'),
      entry(2, 'The kobold misses you!'),
      entry(3, 'The kobold misses you!'),
      entry(4, 'You feel better.'),
    ]);
    expect(grouped).toEqual([
      { text: 'The kobold misses you!', count: 3, turn: 3 },
      { text: 'You feel better.', count: 1, turn: 4 },
    ]);
  });

  it('does not group repeats separated by other messages', () => {
    const grouped = groupLogEntries([
      entry(1, 'The kobold misses you!'),
      entry(2, 'You feel better.'),
      entry(3, 'The kobold misses you!'),
    ]);
    expect(grouped).toHaveLength(3);
    expect(grouped.every((g) => g.count === 1)).toBe(true);
  });

  it('preserves order and handles empty input', () => {
    expect(groupLogEntries([])).toEqual([]);
    const grouped = groupLogEntries([entry(5, 'a'), entry(6, 'b')]);
    expect(grouped.map((g) => g.text)).toEqual(['a', 'b']);
  });
});

describe('buildLogList (UI plan Phase 7)', () => {
  it('renders grouped rows with a visible repeat count', () => {
    const el = buildLogList([
      entry(1, 'The kobold misses you!'),
      entry(2, 'The kobold misses you!'),
      entry(3, 'You feel better.'),
    ]);
    const rows = el.querySelectorAll('.log-entry');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('The kobold misses you!');
    expect(rows[0]?.querySelector('.log-count')?.textContent).toBe('×2');
    expect(rows[1]?.querySelector('.log-count')).toBeNull();
  });

  it('keeps newest entries last (reading order top-to-bottom)', () => {
    const el = buildLogList([entry(1, 'first'), entry(2, 'second')]);
    const rows = [...el.querySelectorAll('.log-entry')];
    expect(rows.map((r) => r.textContent)).toEqual(['first', 'second']);
  });
});

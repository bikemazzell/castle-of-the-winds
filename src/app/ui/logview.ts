/**
 * Expanded message log view (UI plan Phase 7 task 3): consecutive repeated
 * messages group with a "×N" count so combat spam stays readable. The log
 * modal is static while open (modals gate gameplay), so the reading position
 * is preserved by construction — nothing re-renders under the reader.
 */
import type { LogEntry } from '../../engine/types';

export interface GroupedLogEntry {
  text: string;
  count: number;
  /** Turn of the LAST occurrence in the merged run. */
  turn: number;
}

export function groupLogEntries(entries: LogEntry[]): GroupedLogEntry[] {
  const grouped: GroupedLogEntry[] = [];
  for (const e of entries) {
    const prev = grouped[grouped.length - 1];
    if (prev && prev.text === e.text) {
      prev.count += 1;
      prev.turn = e.turn;
    } else {
      grouped.push({ text: e.text, count: 1, turn: e.turn });
    }
  }
  return grouped;
}

export function buildLogList(entries: LogEntry[]): HTMLElement {
  const host = document.createElement('div');
  host.className = 'log-full';
  for (const g of groupLogEntries(entries)) {
    const row = document.createElement('div');
    row.className = 'log-entry';
    row.textContent = g.text;
    if (g.count > 1) {
      const count = document.createElement('span');
      count.className = 'log-count';
      count.textContent = `×${g.count}`;
      row.appendChild(count);
    }
    host.appendChild(row);
  }
  return host;
}

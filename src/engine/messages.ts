/**
 * Original message templating (Task 4.1).
 *
 * The EXE string segment uses printf-like codes with a variadic argument
 * stack (recon: docs/recon/strings.txt):
 *   %t — target article phrase (callers pass "the "; empty for "you")
 *   %i — pops the next argument (monster name, verb, element, item…)
 *   %y — pops the next argument (indefinite article slot, e.g. "a ")
 *   %d — integer (attack count…)
 *   %s / %lu — string / long (UI lists; pops like %i here)
 *   %z — plural suffix ("charge%z" → "charges"); rendered as "s"
 * The game capitalizes rendered sentences, so we capitalize the first
 * alphabetic character of the result.
 */

export interface MessageParams {
  /** Article phrase for the target, e.g. 'the ' (empty for the player). */
  t?: string;
  /** Variadic arguments popped by %i / %y / %s, in order. */
  args?: string[];
  /** Integer for %d / %lu. */
  d?: number;
}

/** Codes that pop the next variadic argument. */
const POPPING = new Set(['i', 'y', 's']);

export function formatMessage(template: string, params: MessageParams = {}): string {
  const args = [...(params.args ?? [])];
  let out = '';
  for (let i = 0; i < template.length; i++) {
    const ch = template[i]!;
    if (ch !== '%' || i + 1 >= template.length) {
      out += ch;
      continue;
    }
    const code = template[i + 1]!;
    if (code === '%') {
      out += '%';
      i++;
    } else if (code === 't') {
      out += params.t ?? '';
      i++;
    } else if (code === 'd' || code === 'u') {
      out += String(params.d ?? 0);
      i++;
    } else if (code === 'z') {
      out += 's';
      i++;
    } else if (POPPING.has(code)) {
      out += args.shift() ?? '';
      i++;
    } else if (code === 'l' && template[i + 2] === 'u') {
      // %lu
      out += String(params.d ?? 0);
      i += 2;
    } else {
      out += ch; // unknown code: keep the '%' literally
    }
  }
  return capitalizeSentence(out);
}

function capitalizeSentence(text: string): string {
  const match = /\w/.exec(text);
  if (!match || match.index === 0) {
    return match && match.index === 0 ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }
  return text.slice(0, match.index) + text.charAt(match.index).toUpperCase() + text.slice(match.index + 1);
}

// ─── Message book (messages.json) ───────────────────────────────────────────

export interface MessageBook {
  /** Original text for a message id, or undefined. */
  text(id: string): string | undefined;
  /** Id of an exact original text, or null (used to verify pools). */
  idFor(text: string): string | null;
}

export function createMessageBook(messages: Record<string, string>): MessageBook {
  const byText = new Map<string, string>();
  for (const [id, text] of Object.entries(messages)) {
    if (!byText.has(text)) byText.set(text, id);
  }
  return {
    text: (id) => messages[id],
    idFor: (text) => byText.get(text) ?? null,
  };
}

// Machine-checked schema/provenance contract for extracted game tables
// (docs/PLAN.md Task 1.7). A decoded JSON file is valid only if:
//   - the provenance envelope is complete (exe, sha256, decoderVersion),
//   - every record carries every required field, OR the absence is covered by
//     an explicit gap entry (table-wide or scoped to that record id),
//   - present fields have the declared type,
//   - record ids are unique,
//   - expectedCount, when present, equals records.length exactly
//     ("count = entries discovered", never a magic range).
// Approximation defaults are applied by engine adapters, never here: this
// module only judges what the extractor actually recovered.

export type FieldType = 'string' | 'number' | 'stringArray';

export interface FieldSpec {
  readonly name: string;
  readonly type: FieldType;
  /** Required = must be present or gap-covered. */
  readonly required: boolean;
}

export interface TableContract {
  readonly kind: 'items' | 'monsters' | 'spells';
  readonly fields: readonly FieldSpec[];
}

export const ITEMS_CONTRACT: TableContract = {
  kind: 'items',
  fields: [
    { name: 'id', type: 'string', required: true },
    { name: 'name', type: 'string', required: true },
    { name: 'kind', type: 'string', required: true },
    { name: 'weight', type: 'number', required: true },
    { name: 'value', type: 'number', required: true },
    { name: 'damage', type: 'string', required: false },
    { name: 'armorClass', type: 'number', required: false },
    { name: 'weaponClass', type: 'number', required: false },
    { name: 'notes', type: 'string', required: false },
  ],
};

export const MONSTERS_CONTRACT: TableContract = {
  kind: 'monsters',
  fields: [
    { name: 'id', type: 'string', required: true },
    { name: 'name', type: 'string', required: true },
    { name: 'hp', type: 'number', required: true },
    { name: 'ac', type: 'number', required: true },
    { name: 'damage', type: 'string', required: true },
    { name: 'speed', type: 'number', required: true },
    { name: 'xp', type: 'number', required: true },
    { name: 'drops', type: 'stringArray', required: false },
    { name: 'notes', type: 'string', required: false },
  ],
};

export const SPELLS_CONTRACT: TableContract = {
  kind: 'spells',
  fields: [
    { name: 'id', type: 'string', required: true },
    { name: 'name', type: 'string', required: true },
    { name: 'manaCost', type: 'number', required: true },
    { name: 'target', type: 'string', required: true },
    { name: 'effect', type: 'string', required: true },
    { name: 'tier', type: 'number', required: false },
    { name: 'notes', type: 'string', required: false },
  ],
};

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const SHA256_RE = /^[0-9a-f]{64}$/i;

function typeOk(value: unknown, type: FieldType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'stringArray':
      return Array.isArray(value) && value.every((v) => typeof v === 'string');
  }
}

interface GapLike {
  field?: unknown;
  reason?: unknown;
  records?: unknown;
}

function gapCovers(gap: GapLike, field: string, id: string): boolean {
  if (gap.field !== field) return false;
  if (gap.records === undefined || gap.records === null) return true;
  return Array.isArray(gap.records) && gap.records.includes(id);
}

/**
 * Validate a decoded table file (already JSON-parsed) against its contract.
 * Returns all problems found; ok === errors.length === 0.
 */
export function validateTableFile(file: unknown, contract: TableContract): ValidationResult {
  const errors: string[] = [];
  const fieldNames = new Set(contract.fields.map((f) => f.name));

  if (typeof file !== 'object' || file === null || Array.isArray(file)) {
    return { ok: false, errors: ['file must be a JSON object'] };
  }
  const f = file as Record<string, unknown>;

  if (typeof f.version !== 'number' || !Number.isFinite(f.version) || f.version < 1) {
    errors.push('version must be a positive number');
  }

  const source = f.source;
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    errors.push('source (provenance) object is required');
  } else {
    const s = source as Record<string, unknown>;
    if (typeof s.exe !== 'string' || s.exe.length === 0) {
      errors.push('source.exe must be a non-empty string');
    }
    if (typeof s.sha256 !== 'string' || !SHA256_RE.test(s.sha256)) {
      errors.push('source.sha256 must be a 64-char hex string');
    }
    if (s.tableOffset !== undefined && (typeof s.tableOffset !== 'number' || !Number.isFinite(s.tableOffset))) {
      errors.push('source.tableOffset must be a number when present');
    }
    if (typeof s.decoderVersion !== 'string' || s.decoderVersion.length === 0) {
      errors.push('source.decoderVersion must be a non-empty string');
    }
  }

  if (!Array.isArray(f.records)) {
    errors.push('records must be an array');
    return { ok: false, errors };
  }

  if (!Array.isArray(f.gaps)) {
    errors.push('gaps must be an array');
    return { ok: false, errors };
  }

  for (const [gi, rawGap] of (f.gaps as unknown[]).entries()) {
    const where = `gaps[${gi}]`;
    if (typeof rawGap !== 'object' || rawGap === null) {
      errors.push(`${where} must be an object`);
      continue;
    }
    const gap = rawGap as GapLike;
    if (typeof gap.field !== 'string' || !fieldNames.has(gap.field)) {
      errors.push(`${where}.field "${String(gap.field)}" is not a contract field`);
    }
    if (typeof gap.reason !== 'string' || (gap.reason).length === 0) {
      errors.push(`${where}.reason must be a non-empty string`);
    }
    if (
      gap.records !== undefined &&
      gap.records !== null &&
      (!Array.isArray(gap.records) || gap.records.some((r) => typeof r !== 'string'))
    ) {
      errors.push(`${where}.records must be an array of record ids when present`);
    }
  }
  const gapList = (f.gaps as unknown[]).filter(
    (g): g is GapLike => typeof g === 'object' && g !== null,
  );

  const seenIds = new Set<string>();
  for (const [ri, rawRecord] of (f.records as unknown[]).entries()) {
    if (typeof rawRecord !== 'object' || rawRecord === null || Array.isArray(rawRecord)) {
      errors.push(`records[${ri}] must be an object`);
      continue;
    }
    const record = rawRecord as Record<string, unknown>;
    const id = record['id'];
    const label = typeof id === 'string' ? id : `records[${ri}]`;
    if (typeof id !== 'string' || id.length === 0) {
      errors.push(`${label}: id must be a non-empty string`);
    } else if (seenIds.has(id)) {
      errors.push(`${label}: duplicate record id`);
    } else {
      seenIds.add(id);
    }
    for (const field of contract.fields) {
      const present = record[field.name] !== undefined;
      if (present) {
        if (!typeOk(record[field.name], field.type)) {
          errors.push(`${label}: field ${field.name} must be of type ${field.type}`);
        }
        continue;
      }
      if (!field.required) continue;
      const covered = gapList.some((g) => gapCovers(g, field.name, typeof id === 'string' ? id : ''));
      if (!covered) {
        errors.push(`${label}: required field ${field.name} missing without a covering gap`);
      }
    }
  }

  if (f.expectedCount !== undefined) {
    if (typeof f.expectedCount !== 'number' || !Number.isFinite(f.expectedCount)) {
      errors.push('expectedCount must be a number when present');
    } else if (f.expectedCount !== (f.records as unknown[]).length) {
      errors.push(
        `expectedCount (${f.expectedCount}) must equal records.length (${(f.records as unknown[]).length})`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

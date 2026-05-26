/** Fallback when DB options_json is empty. */
export const DEFAULT_FIELD_OPTIONS: Record<string, string[]> = {
  target_gender: ['男', '女'],
  member_relationship_status: ['單身', '戀愛中', '已婚', '離婚', '離異'],
  secure_pairing_options: ['顯示用戶名', '不顯示用戶名'],
  target_relationship: ['SP-只有性', 'FWB-有性有愛', 'SL-陪伴為主', '情侶-長遠發展'],
  target_relationship_status: ['不限', '單身', '已婚'],
  target_age: [
    '18-20',
    '21-25',
    '26-30',
    '31-35',
    '36-40',
    '41-45',
    '46-50',
    '20+',
    '25+',
    '30+',
    '35+',
    '40+',
    '45+',
    '50+',
  ],
};

export const GENDER_OPTIONS = [
  { label: '男', value: 'M' as const },
  { label: '女', value: 'F' as const },
];

export function parseGenderInput(text: string): 'M' | 'F' | null {
  const t = text.trim();
  if (t === '男' || t === 'M' || t.toLowerCase() === 'male') return 'M';
  if (t === '女' || t === 'F' || t.toLowerCase() === 'female') return 'F';
  return null;
}

export function genderLabel(value: 'M' | 'F'): string {
  return value === 'M' ? '男' : '女';
}

export function matchChoiceOption(options: string[], text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const exact = options.find((o) => o === t);
  if (exact) return exact;
  const lower = t.toLowerCase();
  return options.find((o) => o.toLowerCase() === lower) ?? null;
}

export function normalizeTargetAgeInput(text: string): string | null {
  const t = text.trim().replace(/歲$/u, '').replace(/\s+/g, '');
  if (!t) return null;

  const range = t.match(/^(\d{1,2})-(\d{1,2})$/);
  if (range) {
    const low = Number(range[1]);
    const high = Number(range[2]);
    if (low >= 18 && high >= low) return `${low}-${high}`;
    return null;
  }

  const plus = t.match(/^(\d{1,2})\+$/);
  if (plus) {
    const min = Number(plus[1]);
    if (min >= 18) return `${min}+`;
    return null;
  }

  return null;
}

export function matchTargetAgeOption(options: string[], text: string): string | null {
  const matched = matchChoiceOption(options, text);
  if (matched) return matched;
  const normalized = normalizeTargetAgeInput(text);
  if (!normalized) return null;
  if (options.includes(normalized)) return normalized;
  return normalized;
}

export function matchChoiceFieldOption(
  fieldKey: string,
  options: string[],
  text: string,
): string | null {
  if (fieldKey === 'target_age') return matchTargetAgeOption(options, text);
  return matchChoiceOption(options, text);
}

export function parseOptionsJson(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map(String).filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      return [];
    }
  }
  return [];
}

export function getFieldOptions(field: {
  field_key: string;
  options_json?: unknown;
}): string[] {
  const fromDb = parseOptionsJson(field.options_json);
  if (fromDb.length) return fromDb;
  return DEFAULT_FIELD_OPTIONS[field.field_key] ?? [];
}

/** A field is a choice when options_json (or fallback) has options. */
export function fieldHasChoiceOptions(field: {
  field_key: string;
  options_json?: unknown;
}): boolean {
  return getFieldOptions(field).length > 0;
}

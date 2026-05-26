/** Fallback when DB options_json is empty. */
export const DEFAULT_FIELD_OPTIONS: Record<string, string[]> = {
  target_gender: ['男', '女'],
  member_relationship_status: ['單身', '戀愛中', '已婚', '離婚', '離異'],
  secure_pairing_options: ['顯示用戶名', '不顯示用戶名'],
  target_relationship: ['SP', 'FWB', 'SP-只有性', 'FWB-有性有愛', 'SL', '情侶-長遠發展', 'SL-陪伴為主'],
  target_relationship_status: ['不限', '單身', '已婚'],
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

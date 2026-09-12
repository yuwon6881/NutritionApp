export type Portion = {label: string; grams: number};

const MAX_PORTIONS = 12;
const MAX_LABEL_LENGTH = 24;
const MIN_GRAMS = 0.1;
const MAX_GRAMS = 10000;

function validGrams(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_GRAMS && value <= MAX_GRAMS;
}

function normalized(value: unknown): Portion | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as {label?: unknown; grams?: unknown};
  const label = typeof item.label === 'string' ? item.label.trim() : '';
  const grams = typeof item.grams === 'number' ? item.grams : Number(item.grams);
  if (!label || label.length > MAX_LABEL_LENGTH || !validGrams(grams)) return undefined;
  return {label, grams};
}

export function parsePortions(json: unknown): Portion[] {
  if (typeof json !== 'string') return [];
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const result: Portion[] = [];
    for (const item of value) {
      const portion = normalized(item);
      if (!portion) continue;
      const key = portion.label.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(portion);
      if (result.length === MAX_PORTIONS) break;
    }
    return result;
  } catch {
    return [];
  }
}

export function validatePortions(list: Portion[]): Portion[] {
  if (list.length > MAX_PORTIONS) throw new Error('A food can have at most 12 portions.');
  const seen = new Set<string>();
  return list.map(item => {
    const portion = normalized(item);
    if (!portion) throw new Error('Each portion needs a label from 1–24 characters and a weight from 0.1–10,000 g.');
    const key = portion.label.toLocaleLowerCase();
    if (seen.has(key)) throw new Error('Portion labels must be unique.');
    seen.add(key);
    return portion;
  });
}

export function serializePortions(list: Portion[]): string {
  const json = JSON.stringify(validatePortions(list));
  if (json.length > 1200) throw new Error('Portions are too large.');
  return json;
}

export type PortionBasis = {
  quantity: number;
  unit: 'g' | 'serving';
  portionLabel: string | null;
  portionGrams: number | null;
};

export function resolveGrams(basis: Partial<PortionBasis>): number | null {
  const quantity = basis.quantity;
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) return null;
  if (basis.unit === 'g') return quantity;
  if (basis.unit !== 'serving') return null;
  if (typeof basis.portionLabel !== 'string' || !basis.portionLabel.trim()) return null;
  const grams = basis.portionGrams;
  if (typeof grams !== 'number' || !Number.isFinite(grams) || grams <= 0) return null;
  const total = quantity * grams;
  return Number.isFinite(total) && total > 0 ? total : null;
}

function displayNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

export function displayPortion(basis: Partial<PortionBasis>): string {
  const qty = typeof basis.quantity === 'number' && Number.isFinite(basis.quantity) ? basis.quantity : 0;
  const quantity = typeof basis.quantity === 'number' && Number.isFinite(basis.quantity) ? displayNumber(basis.quantity) : '—';
  if (basis.unit === 'g') return `${quantity} g`;
  if (basis.portionLabel && typeof basis.portionGrams === 'number' && Number.isFinite(basis.portionGrams) && basis.portionGrams > 0) {
    const totalGrams = displayNumber(basis.portionGrams * qty);
    const label = basis.portionLabel.trim();
    const match = label.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
    if (match) {
      const baseNum = Number(match[1]);
      const rest = match[2];
      if (qty === 1) return `${label} · ${totalGrams} g`;
      if (Number.isFinite(baseNum) && baseNum > 0) {
        const scaled = displayNumber(qty * baseNum);
        return `${scaled}${rest ? ` ${rest}` : ''} · ${totalGrams} g`;
      }
    }
    return `${quantity} ${label} · ${totalGrams} g`;
  }
  return `${quantity} serving`;
}

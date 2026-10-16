import type {Measure} from '../types';

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
    if (!portion) throw new Error('Each portion needs a label from 1–24 characters and an amount from 0.1–10,000 (g or ml).');
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
  measure?: Measure;
};

/**
 * Amounts are stored in `quantity`/`portionGrams`, which hold grams for solids and millilitres for
 * liquids. Records saved before millilitres existed carry no measure and are grams.
 */
export function measureOf(source: {measure?: Measure | null} | null | undefined): Measure {
  return source?.measure === 'ml' ? 'ml' : 'g';
}

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

/**
 * One short measure for tight layouts: the logged mass when it is known, so every
 * card reads "52 g" rather than mixing "1 tart · 52 g" with "75 g". A serving without
 * a frozen mass keeps its honest serving text; no mass is ever invented.
 */
export function displayMass(basis: Partial<PortionBasis>): string {
  const grams = resolveGrams(basis);
  return grams == null ? displayPortion(basis) : `${displayNumber(Math.round(grams * 10) / 10)} ${measureOf(basis)}`;
}

function displayNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

/**
 * Portion nouns that take a regular English plural. Anything else keeps its own spelling: a label is
 * user or provider text, so a guessed plural ("leafs", "Big Macs") would invent wording.
 */
const REGULAR_PORTION_NOUNS = new Set([
  'bag', 'bar', 'biscuit', 'bottle', 'bowl', 'box', 'bun', 'can', 'capsule', 'carton', 'cookie', 'cracker', 'cup', 'egg', 'fillet',
  'glass', 'handful', 'jar', 'link', 'muffin', 'pack', 'packet', 'pancake', 'patty', 'piece', 'plate', 'portion', 'pot', 'roll',
  'sachet', 'sandwich', 'scoop', 'serving', 'sheet', 'slice', 'spoon', 'stick', 'tablespoon', 'tablet', 'teaspoon', 'tub', 'wedge', 'wrap',
]);

function pluralNoun(noun: string): string {
  if (/(s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`;
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}

/** The unit word for a count: inflected only when it is a known regular noun and the count is not one. */
function countedUnit(unit: string, count: number): string {
  return count !== 1 && REGULAR_PORTION_NOUNS.has(unit.toLowerCase()) ? pluralNoun(unit) : unit;
}

export function displayPortion(basis: Partial<PortionBasis>): string {
  const hasQuantity = typeof basis.quantity === 'number' && Number.isFinite(basis.quantity);
  const qty = hasQuantity ? basis.quantity! : 0;
  const quantity = hasQuantity ? displayNumber(basis.quantity!) : '—';
  const measure = measureOf(basis);
  if (basis.unit === 'g') return `${quantity} ${measure}`;
  if (basis.portionLabel && typeof basis.portionGrams === 'number' && Number.isFinite(basis.portionGrams) && basis.portionGrams > 0) {
    const totalGrams = displayNumber(basis.portionGrams * qty);
    const label = basis.portionLabel.trim();
    const match = label.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
    if (match) {
      const baseNum = Number(match[1]);
      const rest = match[2];
      if (qty === 1) return `${label} · ${totalGrams} ${measure}`;
      if (Number.isFinite(baseNum) && baseNum > 0) {
        const scaled = displayNumber(qty * baseNum);
        return `${scaled}${rest ? ` ${countedUnit(rest, qty * baseNum)}` : ''} · ${totalGrams} ${measure}`;
      }
    }
    // A label with no count of its own is the unit: a familiar noun is inflected, any other is multiplied as written.
    const unitText = countedUnit(label, qty);
    const counted = hasQuantity && qty !== 1 && unitText === label ? `${quantity} × ${label}` : `${quantity} ${unitText}`;
    return `${counted} · ${totalGrams} ${measure}`;
  }
  return `${quantity} ${hasQuantity ? countedUnit('serving', qty) : 'serving'}`;
}

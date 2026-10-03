import type { NutritionStore } from '../useNutritionStore';
import type { Entry } from '../types';

export interface LogFoodProps {
  open: boolean;
  store: NutritionStore;
  date: string;
  editing?: Entry;
  onClose: () => void;
  onSaved: () => void;
  onReady?: () => void;
  initialAi?: boolean;
  initialTab?: 'search' | 'saved' | 'barcode' | 'ai';
  initialTime?: string;
  initialQuery?: string;
  restoreFocus?: HTMLElement | null;
}

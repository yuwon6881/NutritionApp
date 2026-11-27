import type { NutritionStore } from '../useNutritionStore';
import type { Entry } from '../types';
import type { QuickAddPrefill } from './QuickAdd';

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
  initialStep?: 'selection' | 'quick';
  initialTime?: string;
  initialQuery?: string;
  initialQuickAdd?: QuickAddPrefill;
  initialAiDescription?: string;
  restoreFocus?: HTMLElement | null;
}

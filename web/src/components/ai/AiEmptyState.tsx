import { ChartNoAxesCombined, Scale, Utensils, type LucideIcon } from 'lucide-react';
import { Button } from '../ui/Button';
import { AiAvatar } from './AiAvatar';

const prompts: { text: string; icon: LucideIcon }[] = [
  { text: 'Show my calorie and macro totals this week', icon: ChartNoAxesCombined },
  { text: 'What did I eat yesterday?', icon: Utensils },
  { text: 'How is my weight trend progressing?', icon: Scale },
];

export function AiEmptyState({ disabled, onPick }: { disabled: boolean; onPick: (prompt: string) => void }) {
  return <div className="ai-chat-empty">
    <AiAvatar size="lg" />
    <h3>Ask about your food, weight, or coaching</h3>
    <p>Answers come from your food log, weight records, and coaching plan. Nothing is logged or changed without your confirmation.</p>
    <ul className="ai-chat-prompts" aria-label="Suggested questions">
      {prompts.map(({ text, icon: Icon }) => <li key={text}>
        <Button disabled={disabled} onClick={() => onPick(text)}><Icon size={16} aria-hidden="true" />{text}</Button>
      </li>)}
    </ul>
  </div>;
}

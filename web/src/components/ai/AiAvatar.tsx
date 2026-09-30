import { Sparkles } from 'lucide-react';

export function AiAvatar({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return <span className={`ai-avatar ${size}`} aria-hidden="true"><Sparkles size={size === 'lg' ? 26 : 15} /></span>;
}

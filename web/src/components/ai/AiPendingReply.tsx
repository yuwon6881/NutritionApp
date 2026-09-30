import { LoaderCircle } from 'lucide-react';
import { AiAvatar } from './AiAvatar';
import { AiMessageContent } from './AiMessageContent';

export interface PendingTurnState { status: string | null; text: string }

export function AiPendingReply({ reply }: { reply: PendingTurnState }) {
  return <div className="ai-chat-message assistant" data-testid="ai-pending-reply">
    <AiAvatar />
    <div className="ai-chat-bubble">
      {reply.text ? <AiMessageContent content={reply.text} role="assistant" />
        : <span className="ai-chat-pending" role="status">
          <LoaderCircle size={15} className="spin" aria-hidden="true" />
          {reply.status ?? 'Thinking'}…
        </span>}
    </div>
  </div>;
}

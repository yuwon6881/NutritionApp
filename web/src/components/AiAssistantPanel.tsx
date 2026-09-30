import { useMemo } from 'react';
import { SquarePen } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { CardFeedback } from './ui/CardFeedback';
import { AiActionReview } from './ai/AiActionReview';
import { AiAvatar } from './ai/AiAvatar';
import { AiComposer } from './ai/AiComposer';
import { AiEmptyState } from './ai/AiEmptyState';
import { AiLog } from './ai/AiLog';
import { AiMessageContent } from './ai/AiMessageContent';
import { AiPendingReply } from './ai/AiPendingReply';
import { useAiConversation, type AiInvocationRequest } from './useAiConversation';
import type { AiUiAction } from '../lib/api/ai';
import './AiAssistantPanel.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onActions: (actions: AiUiAction[]) => void | Promise<void>;
  invocation?: AiInvocationRequest | null;
  onInvocationConsumed?: () => void;
  surface?: string;
}

export function AiAssistantPanel({ isOpen, onClose, onActions, invocation, onInvocationConsumed, surface = 'dashboard' }: Props) {
  const defaultContext = useMemo(() => ({ surface }), [surface]);
  const chat = useAiConversation({ isOpen, onClose, onActions, invocation, onInvocationConsumed, defaultContext });
  const disabled = chat.isSending || chat.isHydrating || chat.isResetting || chat.isResolving;
  const isEmpty = !chat.isHydrating && chat.messages.length === 0 && !chat.pendingReply;
  if (!isOpen) return null;
  return (
    <Modal open={isOpen} title="Ask AI" description="Nutrition assistant" onClose={onClose} width="lg" className="ai-assistant-modal"
      headerActions={chat.hasConversation && <Button variant="tertiary" size="sm" className="ai-chat-new" aria-label="New chat" disabled={disabled}
        onClick={() => void chat.resetConversation()}>
        <SquarePen size={16} aria-hidden="true" /><span>{chat.isResetting ? 'Resetting…' : 'New chat'}</span>
      </Button>}>
      <div className="ai-chat">
        <AiLog messages={chat.messages} pendingReply={chat.pendingReply} actionBatches={chat.pendingActionBatches}>
          {chat.isHydrating && <p className="ai-chat-loading" role="status">Loading conversation…</p>}
          {isEmpty && <AiEmptyState disabled={disabled || Boolean(chat.error)} onPick={prompt => void chat.sendMessage(prompt)} />}
          {chat.messages.map((message, index) => <div key={index} className={`ai-chat-message ${message.role}`}>
            {message.role === 'assistant' && <AiAvatar />}
            <div className="ai-chat-bubble"><AiMessageContent content={message.content} role={message.role} /></div>
          </div>)}
          {chat.pendingReply && <AiPendingReply reply={chat.pendingReply} />}
          {chat.pendingActionBatches.map(batch => <AiActionReview key={batch.batchId} batch={batch} disabled={disabled}
            onResolve={decision => void chat.resolveBatch(batch.batchId, decision)} />)}
        </AiLog>
        {chat.error && <div className="ai-chat-error"><CardFeedback message={chat.error} action={{
          label: chat.lastFailedTurn ? 'Retry message' : 'Reload conversation', disabled,
          onClick: chat.lastFailedTurn ? chat.retryLastFailedTurn : () => void chat.hydrate(),
        }} /></div>}
        <AiComposer value={chat.input} onChange={chat.setInput} onSubmit={() => void chat.sendMessage()}
          onStop={chat.stopTurn} isSending={chat.isSending} disabled={disabled} />
      </div>
    </Modal>
  );
}

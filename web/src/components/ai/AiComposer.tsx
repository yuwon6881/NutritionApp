import { useEffect, useLayoutEffect, useRef } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { Button } from '../ui/Button';
import { TextArea } from '../ui/Field';

const MAX_LENGTH = 2000;
const COUNTER_FROM = 1800;
const MAX_HEIGHT = 144;

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  isSending: boolean;
  disabled: boolean;
}

// Focusing a field on a phone raises the keyboard over the answer the person came to read.
const hasFinePointer = () => window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false;

export function AiComposer({ value, onChange, onSubmit, onStop, isSending, disabled }: Props) {
  const box = useRef<HTMLDivElement>(null);
  // The shared TextArea does not forward a ref, so the field is found inside its frame.
  const field = () => box.current?.querySelector('textarea') ?? null;

  useLayoutEffect(() => {
    const element = field();
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`;
    element.style.overflowY = element.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [value]);

  // A disabled field drops focus, so hand it back once a reply, reset, or reload settles.
  useEffect(() => {
    if (!disabled && hasFinePointer()) field()?.focus({ preventScroll: true });
  }, [disabled]);

  return <form className="ai-chat-composer" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
    <div className="ai-chat-composer-box" ref={box}>
      <TextArea label="Message" rows={1} maxLength={MAX_LENGTH} value={value} disabled={disabled}
        {...(hasFinePointer() ? { 'data-modal-autofocus': true } : {})}
        placeholder="Ask about your nutrition" onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onSubmit();
          }
        }} />
      {isSending
        ? <Button size="icon" aria-label="Stop generating" onClick={onStop}><Square size={16} aria-hidden="true" /></Button>
        : <Button size="icon" type="submit" variant="primary" aria-label="Send message" disabled={disabled || !value.trim()}>
          <ArrowUp size={18} aria-hidden="true" /></Button>}
    </div>
    {value.length >= COUNTER_FROM && <small className="ai-chat-counter" aria-live="polite">{value.length}/{MAX_LENGTH}</small>}
  </form>;
}

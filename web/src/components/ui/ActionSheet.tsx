import {useRef,type ReactNode} from 'react';
import {ChevronRight} from 'lucide-react';
import {Button} from './Button';
import {Modal} from './Modal';

export interface ActionSheetOption {
  id: string;
  label: string;
  description?: string;
  icon: ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}

export interface ActionSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  options: ActionSheetOption[];
  restoreFocus?: HTMLElement|null;
}

export function ActionSheet({
  isOpen,
  onClose,
  title = 'What would you like to add?',
  subtitle = 'Choose an entry type to update your diary',
  options,
  restoreFocus,
}: ActionSheetProps) {
  const pendingAction=useRef<(()=>void)|null>(null);
  const choose=(option:ActionSheetOption)=>{
    pendingAction.current=option.onClick;
    onClose();
  };
  return <Modal open={isOpen} onClose={onClose} onCloseComplete={()=>{
    const action=pendingAction.current;
    pendingAction.current=null;
    action?.();
  }} restoreFocus={restoreFocus} title={title} description={subtitle||undefined} width="sm">
    <div className="action-sheet-options">
      {options.map(option=><Button key={option.id} variant={option.variant??'secondary'} size="lg" className="action-sheet-item" onClick={()=>choose(option)} aria-label={option.label}>
        <span className="action-sheet-item-icon">{option.icon}</span>
        <span className="action-sheet-item-text"><strong>{option.label}</strong>{option.description&&<small>{option.description}</small>}</span>
        <ChevronRight size={18} className="action-sheet-item-chevron"/>
      </Button>)}
    </div>
    <div className="modal-actions"><Button variant="secondary" fullWidth onClick={onClose}>Cancel</Button></div>
  </Modal>;
}

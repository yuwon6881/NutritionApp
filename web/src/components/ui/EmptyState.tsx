import type {LucideIcon} from 'lucide-react';
import type {ReactNode} from 'react';

type EmptyStateProps={
  icon:LucideIcon;
  title:string;
  /** Plain-language hint about what appears here or how to fill it. */
  description?:ReactNode;
  /** Optional call to action, usually a `Button`. */
  action?:ReactNode;
  /** `card` fills a panel, `inline` sits inside a list or chart, `compact` is a tight one-row hint. */
  size?:'card'|'inline'|'compact';
  className?:string;
};

/** The one quiet "nothing here yet" surface: an icon tile, a short title, and a hint. */
export function EmptyState({icon:Icon,title,description,action,size='inline',className}:EmptyStateProps){
  return <div className={`empty-state empty-state-${size}${className?` ${className}`:''}`} role="status">
    <span className="empty-state-icon" aria-hidden="true"><Icon size={size==='compact'?18:size==='card'?28:24} strokeWidth={1.75}/></span>
    <div className="empty-state-copy">
      <p className="empty-state-title">{title}</p>
      {description&&<p className="empty-state-description">{description}</p>}
    </div>
    {action&&<div className="empty-state-action">{action}</div>}
  </div>;
}

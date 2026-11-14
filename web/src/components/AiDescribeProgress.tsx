import {Sparkles} from 'lucide-react';
import {SkeletonBlock} from './ui/Skeleton';
import './ai-describe-progress.css';

const ROWS=[{name:'58%',detail:'36%'},{name:'44%',detail:'30%'}];

/**
 * While a written meal description is being estimated: the outline of the food rows the review will
 * open with, under one honest status line. The description field itself carries the only motion
 * (a slow reading sweep, see `.ai-description-reading`), so this card stays still.
 */
export function AiDescribeProgress(){
  return <div className="ai-describe-progress" aria-busy="true">
    <div className="ai-describe-progress-head">
      <span className="ai-describe-progress-icon" aria-hidden="true"><Sparkles size={16}/></span>
      <div>
        <strong role="status">Estimating nutrients from your description</strong>
        <small>Saved on this device, so it can resume if the connection drops.</small>
      </div>
    </div>
    <div className="ai-describe-progress-rows" aria-hidden="true">
      {ROWS.map((row,index)=><div key={index} className="ai-describe-progress-row">
        <div className="ai-describe-progress-copy"><SkeletonBlock width={row.name} height={13}/><SkeletonBlock width={row.detail} height={10}/></div>
        <SkeletonBlock width={52} height={13}/>
      </div>)}
    </div>
  </div>;
}

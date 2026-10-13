import {ArrowLeft,LoaderCircle} from 'lucide-react';
import {Button} from './ui/Button';
import {CardFeedback} from './ui/CardFeedback';
import {SkeletonBlock} from './ui/Skeleton';
import type {FoodDetailState} from './useFoodDetail';
import {isFatSecretSource} from '../lib/foodSources';
import './food-detail-review.css';

/** The review destination is visible immediately; only confirmed numbers replace its placeholders. */
export function FoodDetailReview({detail,onBack,onRetry,onManual}:{
  detail:FoodDetailState;
  onBack:()=>void;
  onRetry:()=>void;
  onManual?:()=>void;
}){
  return <div className="dialog-step food-detail-review">
    <div className="editor-back-nav">
      <Button variant="tertiary" size="sm" className="subpage-back-button" data-modal-autofocus onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true"/>Back to results
      </Button>
    </div>
    <div className="review-food-heading">
      <h3>{detail.food.name}</h3>
      {!isFatSecretSource(detail.food.source)&&<small className="source">{detail.food.source}</small>}
    </div>
    {detail.error?<>
      <CardFeedback title="Nutrition unavailable" message={detail.error} action={{label:'Retry nutrition lookup',onClick:onRetry}}/>
      {onManual&&<Button variant="tertiary" onClick={onManual}>Enter label manually</Button>}
    </>:<div className="food-detail-loading" aria-busy="true">
      <p className="food-detail-loading-status" role="status"><LoaderCircle size={18} aria-hidden="true"/>Loading nutrition and serving…</p>
      <div className="live-calorie-card" aria-hidden="true">
        <div className="live-calorie-header"><SkeletonBlock width={64} height={12}/><SkeletonBlock width={112} height={32}/></div>
        <SkeletonBlock width="80%" height={12}/>
      </div>
      <div className="form-grid food-detail-fields" aria-hidden="true">
        {[0,1,2].map(index=><div className={index===2?'form-grid-span-all':undefined} key={index}>
          <SkeletonBlock width={70} height={12}/><SkeletonBlock height={44}/>
        </div>)}
      </div>
    </div>}
  </div>;
}

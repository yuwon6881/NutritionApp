import {useEffect,useRef} from 'react';
import {Sparkles} from 'lucide-react';
import {number} from '../../lib/format';
import {measurementLabel} from '../../lib/bodyMeasurements';
import type {BodyMeasurementKey} from '../../types';
import {confidenceLabel,estimateReadiness,formatRange,inputsSummary,requestSignature,type BodyFatEstimateRequest,type EstimateSlot} from '../../lib/bodyFatEstimate';
import {Button} from '../ui/Button';
import {useBodyFatEstimate} from './useBodyFatEstimate';

export interface BodyFatEstimateProps{
  slots:EstimateSlot[];
  online:boolean;
  disabled:boolean;
  request:BodyFatEstimateRequest;
  /** Fills the body-fat field; the dialog's Save still decides whether it is stored. */
  onUse:(percent:number)=>void;
}

export function BodyFatEstimate({slots,online,disabled,request,onUse}:BodyFatEstimateProps){
  const {result,error,busy,pending,estimate,clear}=useBodyFatEstimate();
  const heading=useRef<HTMLHeadingElement>(null);
  const readiness=estimateReadiness(slots,online);
  const stale=Boolean(result&&result.signature!==requestSignature(request));

  // Move focus to the result once it exists so screen-reader and keyboard users land on it.
  useEffect(()=>{if(result)heading.current?.focus({preventScroll:false});},[result]);

  const inputs=result?inputsSummary(result.estimate.inputsUsed):null;
  const measured=result?.estimate.inputsUsed.measurementKeys.map(key=>measurementLabel(key as BodyMeasurementKey).toLowerCase()).join(', ');
  return <div className="body-fat-estimate">
    <div className="body-fat-estimate-action">
      <Button variant="secondary" disabled={!readiness.ready||disabled||pending} aria-describedby="body-fat-estimate-note" onClick={()=>void estimate(request)}>
        <Sparkles size={16} aria-hidden="true"/>{busy?'Estimating…':result?'Estimate again':'Estimate with AI'}
      </Button>
      <p id="body-fat-estimate-note" className="source body-fat-estimate-note">
        {readiness.reason??'Sends the three photos, with your height, weight, sex, age, and entered measurements, to the AI provider for this estimate only. The provider does not keep them. Visual estimates can be off by several points.'}
      </p>
    </div>
    {error&&<p role="alert" className="error">{error}</p>}
    {result&&<section className="body-fat-estimate-result" aria-labelledby="body-fat-estimate-heading" data-stale={stale||undefined}>
      <div className="body-fat-estimate-headline">
        <h4 id="body-fat-estimate-heading" ref={heading} tabIndex={-1}>AI estimate: {number(result.estimate.estimatePercent,1)}%</h4>
        <span className="body-fat-estimate-range">Likely {formatRange(result.estimate.lowPercent,result.estimate.highPercent)} · {confidenceLabel(result.estimate.confidence)}</span>
      </div>
      {stale&&<p className="source body-fat-estimate-stale">Based on earlier data. Estimate again to update.</p>}
      <p className="body-fat-estimate-explanation">{result.estimate.explanation}</p>
      {result.estimate.cues.length>0&&<ul className="body-fat-estimate-cues">{result.estimate.cues.map(cue=><li key={cue}>{cue}</li>)}</ul>}
      <dl className="body-fat-estimate-inputs">
        {result.estimate.formulaPercent!=null&&<><dt>Tape-measure formula</dt><dd>{number(result.estimate.formulaPercent,1)}% (U.S. Navy, from neck, waist{result.estimate.inputsUsed.sex==='female'?', hips':''}, and height)</dd></>}
        <dt>Used</dt><dd>{inputs!.used.join(', ')}{measured?` (${measured})`:''}</dd>
        {inputs!.missing.length>0&&<><dt>Not available</dt><dd>{inputs!.missing.join(', ')}</dd></>}
      </dl>
      <div className="modal-actions body-fat-estimate-actions">
        <Button variant="tertiary" onClick={clear}>Dismiss</Button>
        <Button variant="secondary" disabled={disabled} onClick={()=>onUse(result.estimate.estimatePercent)}>Use {number(result.estimate.estimatePercent,1)}%</Button>
      </div>
    </section>}
  </div>;
}

import {Info} from 'lucide-react';

const EXPLANATION='Some logged foods have no value for this nutrient, so the total may be higher.';

/**
 * Flags a nutrient total that leaves out foods with no value for it. The mark carries its own
 * explanation (tooltip and screen-reader text), so a compact card can show it without a note;
 * fuller summaries add `PartialNote` once.
 */
export function PartialMark(){
  return <span className="partial-mark" title={EXPLANATION}>Partial<span className="sr-only">: {EXPLANATION}</span></span>;
}

/** One quiet line explaining the Partial mark, for summaries with room for it. */
export function PartialNote({className=''}:{className?:string}){
  return <p className={`partial-note ${className}`.trim()}>
    <Info size={14} aria-hidden="true"/>
    <span>Partial: some foods have no value listed, so the total may be higher.</span>
  </p>;
}

/** Flags a nutrient total that leaves out foods with no value for it; `PartialNote` explains it once. */
export function PartialMark(){
  return <span className="partial-mark">Partial</span>;
}

export function PartialNote({className=''}:{className?:string}){
  return <p className={`partial-note ${className}`}>Partial: some logged foods have no value for that nutrient, so its total may be higher.</p>;
}

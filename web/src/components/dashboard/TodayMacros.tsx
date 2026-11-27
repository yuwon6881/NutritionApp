import type {Day,Entry} from '../../types';
import {number} from '../../lib/format';
import {macroStanding,macroStandingCaption,macroStandingLabel} from '../../lib/macroStanding';
import {dayIntake} from '../../lib/weekNutrition';
import {Button} from '../ui/Button';
import {PartialMark} from '../ui/PartialMark';

type Macro='protein'|'carbs'|'fat';
type MacroTargets=Record<Macro,number|null|undefined>;

const MACROS:{key:Macro;label:string}[]=[
  {key:'protein',label:'Protein'},
  {key:'carbs',label:'Carbs'},
  {key:'fat',label:'Fat'},
];

const RADIUS=42;
const CIRCUMFERENCE=2*Math.PI*RADIUS;

/**
 * The Dashboard's macros for one date against its targets: the three macros only, so the card
 * stays a glance (fiber and the longer partial explanation live in the Food Log). Each macro is a
 * small ring in its colour, echoing the energy ring beside it: the centre answers "how much is
 * left" once, and the line under the name carries eaten against target. A total that leaves out
 * foods with no value for the nutrient keeps its compact Partial mark; a nutrient no food reports
 * reads as unknown (—), never as zero.
 */
export function TodayMacros({entries,savedDay,targets,onLogFood}:{entries:Entry[];savedDay:Day|undefined;targets:MacroTargets;onLogFood?:(trigger?:HTMLElement|null)=>void}){
  const {intake,partial}=dayIntake(entries,savedDay);
  // Nothing logged yet today is a known zero; a nutrient no logged food reports stays unknown.
  const empty=!entries.length;
  return <article className="panel macros">
    <div className="dashboard-panel-head macros-head">
      <p className="eyebrow">Macronutrients</p>
      {onLogFood&&<Button variant="tertiary" size="sm" className="dashboard-inline-action" aria-label="Log food from Dashboard" onClick={event=>onLogFood(event.currentTarget)}>Add food</Button>}
    </div>
    {MACROS.map(({key,label})=>{
      const value=intake[key]??(empty?0:null);
      const target=targets[key];
      const standing=macroStanding(value,target);
      return <div className={`macro ${key} is-${standing.kind}`} key={key}>
        <span className="sr-only">{macroStandingLabel(label,value,target)}</span>
        <div className="macro-ring" aria-hidden="true">
          <svg viewBox="0 0 100 100">
            <circle className="macro-ring-track" cx="50" cy="50" r={RADIUS}/>
            {/* A round cap draws a zero-length arc as a dot, which would read as food already eaten. */}
            {standing.fill>0&&<circle className="macro-ring-fill" cx="50" cy="50" r={RADIUS} strokeDasharray={`${standing.fill*CIRCUMFERENCE} ${CIRCUMFERENCE}`} transform="rotate(-90 50 50)"/>}
            {standing.overflow>0&&<circle className="macro-ring-overflow" cx="50" cy="50" r={RADIUS} strokeDasharray={`${standing.overflow*CIRCUMFERENCE} ${CIRCUMFERENCE}`} transform="rotate(-90 50 50)"/>}
          </svg>
          <span className="macro-ring-centre">
            {standing.kind==='on'
              ?<strong><svg className="macro-ring-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></strong>
              :<strong>{number(standing.grams)}</strong>}
            <small>{standing.kind==='left'||standing.kind==='over'||standing.kind==='logged'?' ':''}{macroStandingCaption(standing)}</small>
          </span>
        </div>
        <span className="macro-name" aria-hidden="true">{label}</span>
        <span className="macro-eaten">
          <span aria-hidden="true">{number(value)}<span className="macro-eaten-target">{target==null?' g · No target':` / ${number(target)} g`}</span></span>
          {partial[key]&&<PartialMark/>}
        </span>
      </div>;
    })}
  </article>;
}

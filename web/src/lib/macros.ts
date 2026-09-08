export type MacroKey='protein'|'carbs'|'fat';
export type MacroSplit=Record<MacroKey,number>;
export const macroKeys:MacroKey[]=['protein','carbs','fat'];
export const macroLabels:Record<MacroKey,string>={protein:'Protein',carbs:'Carbohydrate',fat:'Fat'};
/** Energy per gram, used to turn an energy share into grams. */
export const macroEnergy:Record<MacroKey,number>={protein:4,carbs:4,fat:9};
/** Matches the server validation band for each share of daily energy. */
export const macroLimits:Record<MacroKey,{min:number;max:number}>={protein:{min:10,max:60},carbs:{min:0,max:75},fat:{min:15,max:80}};

export type MacroPreset={id:string;label:string;split:MacroSplit|null};
export const macroPresets:MacroPreset[]=[
  {id:'auto',label:'Coach default',split:null},
  {id:'balanced',label:'Balanced',split:{protein:30,carbs:40,fat:30}},
  {id:'high-protein',label:'High protein',split:{protein:40,carbs:35,fat:25}},
  {id:'lower-carb',label:'Lower carb',split:{protein:35,carbs:25,fat:40}},
  {id:'keto',label:'Keto',split:{protein:25,carbs:5,fat:70}},
  {id:'mediterranean',label:'Mediterranean',split:{protein:20,carbs:45,fat:35}},
  {id:'high-carb',label:'High carb',split:{protein:20,carbs:55,fat:25}},
];

const clamp=(value:number,min:number,max:number)=>Math.min(Math.max(value,min),max);

/** Shares of a calorie target, derived from grams, so a coach default can seed the sliders. */
export function splitFromGrams(calories:number|null|undefined,grams:Partial<Record<MacroKey,number|null>>):MacroSplit|null{
  if(!calories||calories<=0)return null;
  const shares=macroKeys.map(key=>{
    const value=grams[key];
    return value==null?null:100*value*macroEnergy[key]/calories;
  });
  if(shares.some(share=>share==null))return null;
  return normalise({protein:shares[0]!,carbs:shares[1]!,fat:shares[2]!});
}

export function gramsFromSplit(calories:number,split:MacroSplit):MacroSplit{
  return {
    protein:Math.round(calories*split.protein/100/macroEnergy.protein),
    carbs:Math.round(calories*split.carbs/100/macroEnergy.carbs),
    fat:Math.round(calories*split.fat/100/macroEnergy.fat),
  };
}

/**
 * Moving one macro moves the other two, because the three shares always describe the same
 * calorie target. Room is taken from each of the others in proportion to what it has to give.
 */
export function adjustSplit(split:MacroSplit,key:MacroKey,requested:number):MacroSplit{
  const target=clamp(Math.round(requested),macroLimits[key].min,macroLimits[key].max);
  const next:MacroSplit={...split,[key]:target};
  const others=macroKeys.filter(other=>other!==key);
  let remaining=split[key]-target;
  for(let pass=0;pass<4&&Math.abs(remaining)>1e-9;pass++){
    const room=others.map(other=>remaining>0?macroLimits[other].max-next[other]:next[other]-macroLimits[other].min);
    const total=room.reduce((sum,value)=>sum+value,0);
    if(total<=1e-9)break;
    let moved=0;
    others.forEach((other,index)=>{
      const share=remaining*room[index]/total;
      next[other]+=share;moved+=share;
    });
    remaining-=moved;
  }
  return normalise(next,key);
}

/** Whole-percent shares that still total 100; the anchored macro keeps the value it was given. */
export function normalise(split:MacroSplit,anchor?:MacroKey):MacroSplit{
  const rounded={protein:Math.round(split.protein),carbs:Math.round(split.carbs),fat:Math.round(split.fat)} as MacroSplit;
  const adjustable=macroKeys.filter(key=>key!==anchor).sort((a,b)=>rounded[b]-rounded[a]);
  let drift=100-macroKeys.reduce((sum,key)=>sum+rounded[key],0);
  for(const key of [...adjustable,...(anchor?[anchor]:[])]){
    if(drift===0)break;
    const next=clamp(rounded[key]+drift,macroLimits[key].min,macroLimits[key].max);
    drift-=next-rounded[key];
    rounded[key]=next;
  }
  return rounded;
}

export const macroPresetId=(split:MacroSplit|null)=>
  (split&&macroPresets.find(preset=>preset.split&&macroKeys.every(key=>preset.split![key]===split[key]))?.id)??(split?'custom':'auto');

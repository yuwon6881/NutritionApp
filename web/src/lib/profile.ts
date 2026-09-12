import type {Profile,ProfileDraft} from '../types';
export function normalizeProfileSex<T extends ProfileDraft>(profile:T):T{
  return profile.sex==='male'?{...profile,pregnancyOrBreastfeeding:false}:profile;
}
export function profilesEqual(left:ProfileDraft,right:Profile|null){
  const canonical=(value:ProfileDraft|Profile|null)=>JSON.stringify(Object.entries(value??{}).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)));
  return canonical(left)===canonical(right);
}

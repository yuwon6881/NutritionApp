import type {ActivityLevel,ProfileDraft} from '../types';

// Mirrors api/Domain/ActivityLevels.cs. The choice decides the Mifflin–St Jeor activity multiplier and
// whether the higher lifting protein target applies; the server re-applies it on save.
type LevelInfo={label:string;description:string;multiplier:number;lifts:boolean};

const levels:Record<ActivityLevel,LevelInfo>={
  none:{label:'None or relaxed activity',description:'Daily life without planned exercise.',multiplier:1.3,lifts:false},
  lifting:{label:'Lifting',description:'Resistance training most weeks.',multiplier:1.5,lifts:true},
  cardio:{label:'Cardio',description:'Running, cycling, swimming or similar most weeks.',multiplier:1.6,lifts:false},
  cardio_lifting:{label:'Cardio & Lifting',description:'Both, most weeks.',multiplier:1.75,lifts:true}
};

export const activityLevels=Object.keys(levels) as ActivityLevel[];

export const activityLevelInfo=(level:ActivityLevel):LevelInfo=>levels[level];

/** The profile fields a choice sets, so the live estimate matches what the server will store. */
export const activityFields=(level:ActivityLevel)=>({activity:levels[level].multiplier,resistanceTraining:levels[level].lifts});

/** For a profile saved before the choice existed: the level closest to its multiplier and lifting flag. */
export function closestActivityLevel(profile:Pick<ProfileDraft,'activity'|'resistanceTraining'>):ActivityLevel|null{
  if(!(profile.activity>0))return null;
  const candidates=activityLevels.filter(level=>levels[level].lifts===profile.resistanceTraining);
  return candidates.reduce((best,level)=>Math.abs(levels[level].multiplier-profile.activity)<Math.abs(levels[best].multiplier-profile.activity)?level:best);
}

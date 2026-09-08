export type RecordBase={id:string;revision:number;deleted:boolean};
export type Nutrients={name:string;calories:number;protein:number|null;fat:number|null;carbs:number|null;fiber:number|null;source:string};
export type Entry=RecordBase&Nutrients&{date:string;meal:string;quantity:number;unit:'g'|'serving'};
export type Food=RecordBase&Nutrients&{servingGrams:number;favourite:boolean;ingredientsJson:string;cookedYieldGrams:number|null};
export type Weight=RecordBase&{date:string;kg:number};
export type Day=RecordBase&{date:string;status:'incomplete'|'complete'|'fasting'|'not_logged';archived?:boolean;entryCount?:number;calories?:number;protein?:number|null;fat?:number|null;carbs?:number|null;fiber?:number|null};
export type Profile={age:number;heightCm:number;weightKg:number;sex:'male'|'female';activity:number;goal:'lose'|'maintain'|'gain';maintenance:number|null;proteinGrams:number|null;resistanceTraining:boolean;pregnancyOrBreastfeeding:boolean;medicalNutrition:boolean;timeZone:string;phaseMode?:'open'|'duration'|'weight';phaseStart?:string|null;durationWeeks?:number|null;targetWeightKg?:number|null;phaseStartWeightKg?:number|null;energyAdjustmentPercent?:number|null};
export type ProfileDraft=Omit<Profile,'sex'|'goal'>&{sex:Profile['sex']|'';goal:Profile['goal']|''};
export type GoalProgress={mode:string;goal?:string;percent:number|null;complete:boolean;estimatedFinish:string|null;phaseEnd:string|null;trendWeight:number|null;startWeight?:number|null;targetWeight?:number|null;remaining?:number|null;weeklyChange:number|null;explanation:string};
export type CoachResult={eligible:boolean;adaptive:boolean;calories:number|null;expenditure:number|null;protein:number|null;fat:number|null;carbs:number|null;explanation:string;version:string;effectiveGoal?:string;phaseComplete?:boolean;goalProgress?:GoalProgress};
export type Plan=RecordBase&{date:string;inputRevision:number;profileRevision:number;resultJson:string};
export type AppState={id:string;username:string;revision:number;profileRevision:number;profile:Profile|null;start:string;end:string;detailCutoff?:string;detailDays?:number;entries:Entry[];foods:Food[];weights:Weight[];weightTrendSeed?:Weight[];energyEstimates?:{date:string;revision:number;expenditure:number}[];days:Day[];plans:Plan[]};
export type Mutation={id:string;kind:'profile'|'entry'|'food'|'weight'|'day';recordId:string;expectedRevision:number;data:unknown;delete:boolean;error?:string};
export type ScanDraft={id:string;mode:'photo'|'label'|'description';description:string;imageBase64:string|null;jobId?:string;result?:AiDraft;error?:string};
export type AiFood={name:string;quantity:number;unit:'g'|'serving';calories:number;protein:number|null;fat:number|null;carbs:number|null;fiber:number|null;notes:string};
export type AiDraft={foods:AiFood[];questions:string[];explanation:string};
export type PhysiqueDraft={id:string;date:string;caption:string;angle:string;imageBase64:string;error?:string};
export type LocalData={state:AppState;queue:Mutation[];scans:ScanDraft[];photoDrafts?:PhysiqueDraft[]};
export const blankNutrients:Nutrients={name:'',calories:0,protein:null,fat:null,carbs:null,fiber:null,source:'manual'};



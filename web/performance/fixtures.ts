import type {AppState,LocalData,ProgressSummary} from '../src/types';

export function performanceFixture(days:number,outbox=0):LocalData {
  const date=(offset:number)=>new Date(Date.now()-offset*86400000).toISOString().slice(0,10);
  const end=date(0);
  const state:AppState={id:'performance-account',displayName:'Performance',revision:1,profileRevision:1,
    diaryRevision:1,trajectoryRevision:1,bodyRevision:1,foodRevision:1,
    profile:{age:30,dateOfBirth:null,heightCm:175,weightKg:80,sex:'male',activity:1.4,goal:'maintain',maintenance:2400,
      proteinGrams:null,resistanceTraining:false,pregnancyOrBreastfeeding:false,medicalNutrition:false,timeZone:'UTC'},
    settings:{checkInWeekday:1,revision:1},start:date(89),end,detailCutoff:date(89),detailDays:90,
    entries:[],weights:[],foods:[],days:[],plans:[],checkIns:[],phaseDecisions:[],trainingSummaries:[],workoutConnected:false};
  for(let i=0;i<days;i++) {
    state.weights.push({id:`weight-${i}`,revision:1,deleted:false,date:date(i),kg:80+i%4*.1});
    state.days.push({id:`day-${i}`,revision:1,deleted:false,date:date(i),status:'complete',archived:i>=90,entryCount:8,calories:1600});
    if(i<90)for(let j=0;j<8;j++)state.entries.push({id:`entry-${i}-${j}`,revision:1,deleted:false,date:date(i),time:`${String(8+j).padStart(2,'0')}:00`,
      name:`Food ${j}`,calories:200,protein:10,carbs:20,fat:5,fiber:null,source:'manual',quantity:100,unit:'g'});
  }
  state.foods=Array.from({length:1000},(_,i)=>({id:`food-${i}`,revision:1,deleted:false,name:`Saved food ${i}`,calories:100,protein:null,carbs:null,fat:null,fiber:null,
    source:'manual',servingGrams:100,favourite:false,ingredientsJson:'',portionsJson:'[]',cookedYieldGrams:null}));
  const queue:LocalData['queue']=Array.from({length:outbox},(_,i)=>({id:`retained-${i}`,kind:'weight',recordId:`weight-${i}`,expectedRevision:1,delete:false,
    data:{date:date(i),kg:81},error:'Retained conflict'}));
  return {state,foodsLoaded:true,queue,photoDrafts:days<3650?[]:[{id:'retained-photo',date:end,
    photos:[{id:'photo',angle:'front',imageBase64:'A'.repeat(1_500_000)}],error:'Retained benchmark draft'}]};
}

export function performanceSummary(state:AppState):ProgressSummary {
  return {period:'month',start:state.start,end:state.end,revision:state.revision,grouping:{weight:'daily',energy:'daily'},
    weight:{statistics:{count:30,averageKg:80,minimumKg:80,maximumKg:81,firstKg:80,latestKg:80,latestTrendKg:80,trendChangeKg:0},
      series:state.weights.slice(0,30).reverse().map(w=>({date:w.date,scaleKg:w.kg,trendKg:w.kg})),editableWeighIns:state.weights.slice(0,10)},
    energy:{statistics:{days:30,loggedDays:30,completeDays:30,totalIntake:48000,averageIntake:1600,averageMaintenance:2400,totalBalance:-24000,surplusDays:0,deficitDays:30},
      series:[]}};
}

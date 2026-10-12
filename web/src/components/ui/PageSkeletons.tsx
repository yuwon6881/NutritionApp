import {DashboardSkeleton,FoodDaySkeleton,SkeletonBlock} from './Skeleton';

export type SkeletonPage='today'|'food'|'progress'|'coach'|'settings';

/** Page heading and, where the page has them, its section tabs. */
function PageTop({tabs=0}:{tabs?:number}){
  return <>
    <SkeletonBlock width="38%" height={34} className="skeleton-heading"/>
    {tabs>0&&<div className="page-skeleton-tabs">{Array.from({length:tabs},(_,index)=><SkeletonBlock key={index} height={36} radius={999}/>)}</div>}
  </>;
}

function FoodLogSkeleton(){
  return <>
    <PageTop/>
    <div className="page-skeleton-strip">{Array.from({length:7},(_,index)=><SkeletonBlock key={index} width={56} height={78} radius={999}/>)}</div>
    <div className="panel skeleton-panel"><SkeletonBlock width="30%" height={22}/><SkeletonBlock height={8} radius={999}/>
      <div className="page-skeleton-tiles">{[0,1,2].map(index=><SkeletonBlock key={index} height={64} radius={16}/>)}</div>
    </div>
    <FoodDaySkeleton/>
  </>;
}

function ProgressSkeleton(){
  return <>
    <PageTop tabs={4}/>
    <div className="page-skeleton-tiles">{[0,1,2].map(index=><div key={index} className="panel skeleton-panel"><SkeletonBlock width="60%" height={10}/><SkeletonBlock width="45%" height={28}/></div>)}</div>
    <div className="panel skeleton-panel"><SkeletonBlock width="25%" height={18}/><SkeletonBlock height={220} radius={16}/></div>
  </>;
}

function CoachSkeleton(){
  return <>
    <PageTop tabs={3}/>
    <div className="panel skeleton-panel"><SkeletonBlock width="35%" height={18}/><SkeletonBlock width="30%" height={40}/><SkeletonBlock height={8} radius={999}/>
      <div className="page-skeleton-tiles">{[0,1,2].map(index=><SkeletonBlock key={index} height={72} radius={16}/>)}</div>
    </div>
  </>;
}

function SettingsSkeleton(){
  return <>
    <PageTop/>
    <div className="panel skeleton-panel"><SkeletonBlock width="20%" height={10}/><SkeletonBlock width="35%" height={20}/></div>
    <div className="panel skeleton-panel">{[0,1,2,3].map(index=><div key={index} className="page-skeleton-row"><SkeletonBlock width="40%"/><SkeletonBlock width={120} height={36} radius={999}/></div>)}</div>
  </>;
}

/**
 * A placeholder shaped like the page that is opening, so content lands where its outline was
 * instead of every page flashing the Dashboard's shape first.
 */
export function PageSkeleton({page,label}:{page:SkeletonPage;label:string}){
  if(page==='today')return <DashboardSkeleton label={label}/>;
  return <div className="page-skeleton" aria-busy="true">
    <p className="sr-only" role="status">{label}</p>
    {page==='food'?<FoodLogSkeleton/>:page==='progress'?<ProgressSkeleton/>:page==='coach'?<CoachSkeleton/>:<SettingsSkeleton/>}
  </div>;
}

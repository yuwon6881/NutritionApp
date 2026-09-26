import type {CSSProperties} from 'react';

/**
 * Static placeholders shaped like the content they stand in for, so the
 * layout does not jump when data arrives. Deliberately motionless (no
 * shimmer): idle attention-seeking motion is not used in this app.
 */
export function SkeletonBlock({width='100%',height=14,radius=8,className=''}:{width?:string|number;height?:number;radius?:number;className?:string}){
  return <span className={`skeleton-block ${className}`.trim()} aria-hidden="true" style={{width,height,borderRadius:radius} as CSSProperties}/>;
}

/** Placeholder for the Dashboard while the diary opens from this device or the server. */
export function DashboardSkeleton({label}:{label:string}){
  return <div className="dashboard-skeleton" aria-busy="true">
    <p className="sr-only" role="status">{label}</p>
    <SkeletonBlock width="46%" height={34} className="skeleton-heading"/>
    <div className="daily-grid">
      <div className="panel skeleton-panel"><SkeletonBlock width="30%" height={10}/><SkeletonBlock width="55%" height={30}/><SkeletonBlock width="40%"/></div>
      <div className="panel skeleton-panel">{[0,1,2].map(index=><SkeletonBlock key={index} height={10}/>)}</div>
    </div>
  </div>;
}

/** Placeholder rows for a Food Log day that is still loading. */
export function FoodDaySkeleton(){
  return <div className="food-day-skeleton" aria-hidden="true">
    {[0,1,2].map(index=><div key={index} className="food-day-skeleton-row">
      <SkeletonBlock width={52} height={12}/>
      <div className="panel skeleton-panel"><SkeletonBlock width="60%"/><SkeletonBlock width="40%" height={10}/></div>
    </div>)}
  </div>;
}

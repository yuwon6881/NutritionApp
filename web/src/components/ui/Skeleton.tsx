import type {CSSProperties,ReactNode} from 'react';

/**
 * Static placeholders shaped like the content they stand in for, so the
 * layout does not jump when data arrives. Deliberately motionless (no
 * shimmer): idle attention-seeking motion is not used in this app.
 */
export function SkeletonBlock({width='100%',height=14,radius=8,className=''}:{width?:string|number;height?:number;radius?:number;className?:string}){
  return <span className={`skeleton-block ${className}`.trim()} aria-hidden="true" style={{width,height,borderRadius:radius} as CSSProperties}/>;
}

/** Placeholder for the Dashboard while the diary opens from this device or the server. */
export function DashboardSkeleton({label,heading=true}:{label:string;heading?:boolean}){
  return <div className="dashboard-skeleton" aria-busy="true">
    <p className="sr-only" role="status">{label}</p>
    {heading&&<SkeletonBlock width="46%" height={34} className="skeleton-heading"/>}
    <div className="daily-grid">
      <div className="panel skeleton-panel"><SkeletonBlock width="30%" height={10}/><SkeletonBlock width="55%" height={30}/><SkeletonBlock width="40%"/></div>
      <div className="panel skeleton-panel">{[0,1,2].map(index=><SkeletonBlock key={index} height={10}/>)}</div>
    </div>
  </div>;
}

const MACRO_TILES=['protein','carbs','fat'];
const TIMELINE_ROWS=[{title:'58%',energy:52},{title:'72%',energy:44},{title:'46%',energy:52}];

/**
 * The Food Log day summary in its final arrangement: title and status on the left, energy on the right,
 * the calorie bar, then three macro tiles. It reuses the real classes so the panel keeps the real height.
 * The title is known from the date, so it renders as text when given.
 */
export function FoodDaySummarySkeleton({title}:{title?:string}){
  return <section className="panel food-day-summary food-day-summary-skeleton" aria-hidden="true">
    <div className="section-heading">
      <div className="food-day-title-group">
        {title?<h2>{title}</h2>:<SkeletonBlock width={160} height={26} className="food-day-skeleton-title"/>}
        <SkeletonBlock width={132} height={26} radius={999} className="food-day-skeleton-status"/>
      </div>
      <div className="food-day-energy">
        <SkeletonBlock width={92} height={36}/>
        <SkeletonBlock width={104} height={13}/>
      </div>
    </div>
    <SkeletonBlock height={10} radius={999} className="food-day-skeleton-bar"/>
    <div className="food-day-nutrients">{MACRO_TILES.map(macro=><div key={macro} className={`food-day-nutrient ${macro}`}>
      <SkeletonBlock width="46%" height={14}/>
      <div className="food-day-skeleton-value"><SkeletonBlock width="62%" height={20}/><SkeletonBlock width="44%" height={12}/></div>
      <SkeletonBlock height={8} radius={999}/>
    </div>)}</div>
  </section>;
}

/** The Food timeline heading, its view switch and a few time rows with their cards. */
export function FoodDayTimelineSkeleton(){
  return <div aria-hidden="true">
    <div className="food-timeline-toolbar">
      <h2>Food timeline</h2>
      <SkeletonBlock width="100%" height={52} radius={999} className="food-day-skeleton-switch"/>
    </div>
    <ol className="food-timeline">
      {TIMELINE_ROWS.map((row,index)=><li key={index} className="food-time-row">
        <div className="food-time-label"><SkeletonBlock width={44} height={12} className="food-day-skeleton-time"/></div>
        <div className="food-time-cards">
          <div className="panel food-time-card">
            <div className="food-day-skeleton-header">
              <SkeletonBlock width={row.title} height={16}/>
              <SkeletonBlock width={row.energy} height={16}/>
            </div>
            <div className="food-day-skeleton-details"><SkeletonBlock width="38%" height={12}/><SkeletonBlock width="62%" height={12} className="food-day-skeleton-macros"/></div>
          </div>
        </div>
      </li>)}
    </ol>
  </div>;
}

/** A Food Log day that is still loading: one polite status line over the summary and timeline shapes. */
export function FoodDaySkeleton({title,label='Loading diary…'}:{title?:string;label?:string}){
  return <div className="food-day-skeleton" aria-busy="true">
    <p className="sr-only" role="status">{label}</p>
    <FoodDaySummarySkeleton title={title}/>
    <FoodDayTimelineSkeleton/>
  </div>;
}

/** Wraps placeholders with one polite status line, so a screen reader hears what is loading instead of nothing. */
export function SkeletonRegion({label,className='',children}:{label:string;className?:string;children:ReactNode}){
  return <div className={`skeleton-region ${className}`.trim()} aria-busy="true">
    <p className="sr-only" role="status">{label}</p>
    {children}
  </div>;
}

/** Figure tiles (small label over a value), as in the Progress statistics. */
export function SkeletonStats({count=3}:{count?:number}){
  return <div className="stats-grid skeleton-stats" aria-hidden="true">
    {Array.from({length:count},(_,index)=><div key={index} className="stat-card skeleton-panel">
      <SkeletonBlock width="55%" height={10}/><SkeletonBlock width="40%" height={26}/>
    </div>)}
  </div>;
}

const CHART_BAR_HEIGHTS=[46,62,38,70,54,80,48,66,42,74,58,50];

/** Bars on a baseline, at the height the chart they stand in for will occupy. */
export function SkeletonChart({height=220}:{height?:number}){
  return <div className="skeleton-chart" aria-hidden="true" style={{height}}>
    {CHART_BAR_HEIGHTS.map((bar,index)=><span key={index} className="skeleton-block" style={{height:`${bar}%`}}/>)}
  </div>;
}

/** Setting rows: a label and a hint on the left, the control on the right. */
export function SkeletonSettingRows({count=2}:{count?:number}){
  return <div className="skeleton-setting-rows" aria-hidden="true">
    {Array.from({length:count},(_,index)=><div key={index} className="page-skeleton-row">
      <div className="skeleton-setting-copy"><SkeletonBlock width="46%" height={14}/><SkeletonBlock width="78%" height={10}/></div>
      <SkeletonBlock width={96} height={36} radius={999}/>
    </div>)}
  </div>;
}

/** Message bubbles for a conversation that is still opening. */
export function SkeletonChat(){
  return <div className="skeleton-chat" aria-hidden="true">
    <SkeletonBlock width="72%" height={56} radius={18}/>
    <SkeletonBlock width="46%" height={40} radius={18} className="skeleton-chat-own"/>
    <SkeletonBlock width="64%" height={72} radius={18}/>
  </div>;
}

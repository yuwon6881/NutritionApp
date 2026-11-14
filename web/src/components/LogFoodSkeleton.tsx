import {SkeletonBlock,SkeletonRegion} from './ui/Skeleton';

const ROW_WIDTHS=[{name:'62%',detail:'38%'},{name:'48%',detail:'44%'},{name:'70%',detail:'32%'},{name:'54%',detail:'40%'}];

/**
 * The food picker while its diary date or unfinished batch is still opening: the shortcuts, the
 * method switch, the search field and a short list of food rows, so the dialog keeps its size and
 * the real controls land where their outlines were.
 */
export function LogFoodSkeleton({label}:{label:string}){
  return <SkeletonRegion label={label} className="dialog-step food-selection log-food-skeleton">
    <div className="log-food-skeleton-shortcuts" aria-hidden="true">
      <SkeletonBlock width={104} height={32} radius={999}/>
      <SkeletonBlock width={88} height={32} radius={999}/>
    </div>
    <SkeletonBlock height={44} radius={999}/>
    <SkeletonBlock height={44} radius={12}/>
    <div className="log-food-skeleton-list" aria-hidden="true">
      <SkeletonBlock width={96} height={12}/>
      {ROW_WIDTHS.map((row,index)=><div key={index} className="log-food-skeleton-row">
        <div className="log-food-skeleton-copy"><SkeletonBlock width={row.name} height={14}/><SkeletonBlock width={row.detail} height={11}/></div>
        <SkeletonBlock width={20} height={20} radius={999}/>
      </div>)}
    </div>
  </SkeletonRegion>;
}

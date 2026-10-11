import {SkeletonBlock} from '../ui/Skeleton';

/** Placeholder for the Body tab hub, built on its real layout so the loaded view replaces it in place. */
export function BodyHubSkeleton(){
  return <section className="panel physique physique-photo-home" aria-busy="true">
    <p className="sr-only" role="status">Opening body records…</p>
    <div className="section-heading"><div><h2>Body</h2></div><SkeletonBlock width={150} height={44} radius={12}/></div>
    <div className="body-hub-list">
      {[0,1].map(index=><div key={index} className="body-hub-row">
        <SkeletonBlock width={44} height={44} radius={12}/>
        <span className="body-hub-skeleton-lines"><SkeletonBlock width="55%" height={16}/><SkeletonBlock width="80%" height={11}/></span>
        <div className="body-hub-actions"><SkeletonBlock width={140} height={44} radius={12}/><SkeletonBlock width={120} height={44} radius={12}/></div>
      </div>)}
    </div>
  </section>;
}

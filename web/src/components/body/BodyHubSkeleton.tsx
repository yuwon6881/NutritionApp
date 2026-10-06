import {SkeletonBlock} from '../ui/Skeleton';

/** Placeholder for the Body tab hub, built on its real layout so the loaded view replaces it in place. */
export function BodyHubSkeleton(){
  return <section className="panel physique physique-photo-home" aria-busy="true">
    <p className="sr-only" role="status">Opening body records…</p>
    <div className="section-heading"><div><h2>Body</h2></div></div>
    <div className="body-hub-grid">
      {[0,1].map(index=><div key={index} className="body-hub-card">
        <div className="body-hub-card-header">
          <SkeletonBlock width={44} height={44} radius={12}/>
          <span className="body-hub-skeleton-lines"><SkeletonBlock width="60%" height={16}/><SkeletonBlock width="85%" height={11}/></span>
        </div>
        <div className="body-hub-card-footer"><SkeletonBlock width={140} height={44} radius={12}/><SkeletonBlock width={120} height={44} radius={12}/></div>
      </div>)}
    </div>
    <div className="body-hub-compare-cta"><SkeletonBlock width={210} height={44} radius={12}/></div>
  </section>;
}

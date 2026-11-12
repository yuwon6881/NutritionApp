import {BookOpen,CloudOff} from 'lucide-react';
import {Button} from './ui/Button';
import {ChartCardSkeleton,DashboardSkeleton,SkeletonBlock} from './ui/Skeleton';
import {useDelayedPending} from './ui/useDelayedPending';
import type {SkeletonPage} from './ui/PageSkeletons';
import {PageSkeleton} from './ui/PageSkeletons';

// A cold server can take several seconds; past this the screen says what is happening.
const SLOW_START_MS=3000;

/**
 * Shown while the account's diary state is not on screen yet. It names what is happening, says
 * plainly when the server is slow to wake, and keeps the page's own outline behind it.
 */
export function OpeningDiary({page,online,onSignOut}:{page:SkeletonPage;online:boolean;onSignOut:()=>void}){
  const slow=useDelayedPending(true,SLOW_START_MS);
  const offline=!online;
  const detail=offline?'You are offline. Your saved diary opens once it is on this device.':slow?'The server is waking up. This can take a few seconds, then your diary opens.':'Getting your diary ready.';
  const Icon=offline?CloudOff:BookOpen;
  return <div className="opening-diary">
    <section className="panel opening-diary-status" aria-busy="true">
      <span className="coach-icon-tile" aria-hidden="true"><Icon size={18}/></span>
      <div className="opening-diary-copy">
        <h2>Opening your diary</h2>
        <p role="status">{detail}</p>
      </div>
    </section>
    <div className="opening-diary-outline" aria-hidden="true">
      {page==='today'?<>
        <DashboardSkeleton label="" heading={false}/>
        <div className="panel skeleton-panel"><SkeletonBlock width="34%" height={16}/><SkeletonBlock height={64} radius={16}/></div>
        <ChartCardSkeleton/>
      </>:<PageSkeleton page={page} label=""/>}
    </div>
    <div className="actions opening-diary-actions"><Button variant="tertiary" onClick={onSignOut}>Back to sign in</Button></div>
  </div>;
}

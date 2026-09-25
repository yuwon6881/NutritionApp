import {useState} from 'react';
import {clearUserCache,countAccountLocalWork,type AccountLocalWorkCounts} from '../lib/local';
import {Button} from './ui/Button';
import {CardFeedback} from './ui/CardFeedback';
import {Modal} from './ui/Modal';
import {SettingRow} from './ui/SettingRow';
import {useAsyncAction} from './ui/useAsyncAction';

const countLabels:[keyof AccountLocalWorkCounts,string][]=[
  ['outboxMutations','Outbox changes'],
  ['bodyDrafts','Body drafts'],
  ['photoDrafts','Photo drafts'],
  ['foodBasketDrafts','Food basket drafts'],
  ['scanDrafts','Food scan drafts']
];

export function LocalDataSettings({accountId,onLogout}:{accountId:string;onLogout:()=>Promise<void>}){
  const [open,setOpen]=useState(false);
  const [counts,setCounts]=useState<AccountLocalWorkCounts>();
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const {busy,run}=useAsyncAction();

  const review=()=>void (async()=>{
    setError('');
    setNotice('');
    try{
      await run(async()=>{
        setCounts(await countAccountLocalWork(accountId));
        setOpen(true);
      });
    }catch(ex){setError((ex as Error).message);}
  })();

  const confirm=()=>void (async()=>{
    setNotice('');
    try{
      await run(async()=>{
        const current=await countAccountLocalWork(accountId);
        const changed=!counts||Object.keys(current).some(key=>current[key as keyof AccountLocalWorkCounts]!==counts[key as keyof AccountLocalWorkCounts]);
        if(changed){
          setCounts(current);
          setNotice('The pending-work count changed. Review the updated count and confirm again to remove it.');
          return;
        }
        await clearUserCache(accountId);
        await onLogout();
        // A foreground sync may finish while the existing logout path revokes push
        // credentials. Remove any cache it restored before this flow returns.
        await clearUserCache(accountId);
      });
    }catch(ex){
      setNotice(`Local data could not be fully removed. ${((ex as Error).message??'Please try again.')}`);
    }
  })();

  return <>
    <SettingRow className="setting-row-danger" label={<h3 className="setting-row-heading">Local Nutrition data</h3>}
      description="Removes this account's cache and device-only work from this browser, then signs you out. Records already synced to your account stay there.">
      <Button variant="destructive" disabled={busy} onClick={review}>Remove local data…</Button>
    </SettingRow>
    {error&&<CardFeedback title="Local data unavailable" message={error}/>}
    <Modal open={open} onClose={()=>{if(!busy)setOpen(false);}} title="Remove local Nutrition data?" description="This removes Nutrition data for this account from this browser and signs you out." width="sm" preventDismiss={busy}>
      <div className="local-data-dialog">
        <p>Device-only pending work will be removed. Server-synced Nutrition data stays in your account. Other accounts and notification revocation work on this device are kept.</p>
        {counts&&<>
          <p><strong>Pending work on this device: {counts.total}</strong></p>
          <dl className="local-data-counts">
            {countLabels.map(([key,label])=><div key={key}><dt>{label}</dt><dd>{counts[key]}</dd></div>)}
          </dl>
        </>}
        {notice&&<p className="notice" role="status">{notice}</p>}
        <div className="actions">
          <Button variant="secondary" disabled={busy} onClick={()=>setOpen(false)}>Keep local data</Button>
          <Button variant="destructive" disabled={busy||!counts} onClick={confirm}>{busy?'Removing…':'Remove local data & sign out'}</Button>
        </div>
      </div>
    </Modal>
  </>;
}

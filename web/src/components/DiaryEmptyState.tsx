import {CloudOff,Clock,Utensils} from 'lucide-react';
import {Button} from './ui/Button';
import {EmptyState} from './ui/EmptyState';

export function DiaryEmptyState({status,offline=false,unavailable=false,onLog}:{status:string;offline?:boolean;unavailable?:boolean;onLog?:()=>void}){
  const icon=offline||unavailable?CloudOff:status==='fasting'?Clock:Utensils;
  const title=unavailable?'Diary details unavailable':offline?'No food entries saved on this device for today.':status==='fasting'?'This day is marked as fasting.':status==='not_logged'?'This day is marked as not logging.':'No food entries for this day.';
  const message=unavailable?'Connect or retry history to view this day’s saved entries.':offline?'Connect to load other entries. You can keep logging today.':status==='fasting'?'No intake is recorded for this fasting day. Logging food updates its status automatically.':status==='not_logged'?'Intake is unknown for this day. Your weights and trends are retained.':'Log your first food to see calories, nutrients, and meal times here.';
  return <section className="panel diary-empty-state">
    <EmptyState size="card" icon={icon} title={title} description={message} action={onLog&&<Button variant="secondary" onClick={onLog}>Add food</Button>}/>
  </section>;
}

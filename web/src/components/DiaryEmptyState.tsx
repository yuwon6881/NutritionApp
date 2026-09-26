import {BookOpen,CloudOff,Clock,Utensils} from 'lucide-react';
import {Button} from './ui/Button';

export function DiaryEmptyState({status,offline=false,unavailable=false,archived=false,detailDays=90,summary,onLog}:{status:string;offline?:boolean;unavailable?:boolean;archived?:boolean;detailDays?:number;summary?:string;onLog?:()=>void}){
  const Icon=archived?BookOpen:offline||unavailable?CloudOff:status==='fasting'?Clock:Utensils;
  const title=archived?'Daily summary':unavailable?'Diary details unavailable':offline?'No food entries saved on this device for today.':status==='fasting'?'This day is marked as fasting.':status==='not_logged'?'This day is marked as not logging.':'No food entries for this day.';
  const message=archived?`Individual food details are kept for ${detailDays} days. This saved summary is read-only.`:unavailable?'Connect or retry history to view this day’s saved entries.':offline?'Connect to load other entries. You can keep logging today.':status==='fasting'?'No intake is recorded for this fasting day. Logging food updates its status automatically.':status==='not_logged'?'Intake is unknown for this day. Your weights and trends are retained.':'Log your first food to see calories, nutrients, and meal times here.';
  return <section className="panel diary-empty-state">
    <span className="diary-empty-icon"><Icon size={24} aria-hidden="true"/></span>
    <h3>{title}</h3>
    {summary&&<p>{summary}</p>}
    <p>{message}</p>
    {!archived&&onLog&&<Button variant="secondary" onClick={onLog}>Add food</Button>}
  </section>;
}

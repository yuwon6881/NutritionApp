import type {BodyRecord,PhysiqueAngle} from '../../types';
import {readableDate} from '../../lib/format';
import {angleLabel,angles,photoContentUrl} from '../../lib/bodyMeasurements';
import {SegmentedControl} from '../ui/SegmentedControl';
import {PhotoFrame} from './PhotoFrame';
import {RecordNavigator} from './RecordNavigator';

const photoSrc=(set:BodyRecord|undefined,angle:PhysiqueAngle)=>{
  const photo=set?.photos.find(item=>item.angle===angle&&item.status==='complete');
  return photo?photoContentUrl(photo):undefined;
};

export interface PhotoSetViewerProps{
  sets:BodyRecord[];
  index:number;
  angle:PhysiqueAngle;
  hasMore:boolean;
  busy:boolean;
  onAngle:(angle:PhysiqueAngle)=>void;
  onOlder:()=>void;
  onNewer:()=>void;
}

/** Steps through gallery photo sets; the next older page loads when the last loaded set is reached. */
export function PhotoSetViewer({sets,index,angle,hasMore,busy,onAngle,onOlder,onNewer}:PhotoSetViewerProps){
  const current=sets[index];
  if(!current)return null;
  const older=index+1<sets.length||hasMore?onOlder:undefined;
  const newer=index>0?onNewer:undefined;
  return <section className="panel photo-viewer-panel">
    <SegmentedControl<PhysiqueAngle> className="photo-angle-selector" label="Photo angle" value={angle} onChange={onAngle} options={angles.map(value=>({value,label:angleLabel(value)}))}/>
    <PhotoFrame src={photoSrc(current,angle)} alt={`${angleLabel(angle)} physique photo from ${readableDate(current.date)}`}
      emptyTitle={angleLabel(angle)} emptyText={current.photos.some(photo=>photo.angle===angle&&photo.status==='pending')?'Upload pending':'Not uploaded'}
      preloadSrc={photoSrc(sets[index+1],angle)??photoSrc(sets[index-1],angle)} onOlder={busy?undefined:older} onNewer={busy?undefined:newer}/>
    <RecordNavigator noun="Set" index={index} total={sets.length} moreOlder={hasMore} date={readableDate(current.date)} busy={busy} onOlder={older} onNewer={newer}/>
  </section>;
}

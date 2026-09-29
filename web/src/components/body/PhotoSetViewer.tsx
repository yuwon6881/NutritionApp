import type {PhysiqueAngle,PhysiquePhotoSet} from '../../types';
import {angleLabel,angles} from '../../lib/bodyMeasurements';
import {SegmentedControl} from '../ui/SegmentedControl';
import {PhotoFrame} from './PhotoFrame';
import {RecordNavigator} from './RecordNavigator';

const photoSrc=(set:PhysiquePhotoSet|undefined,angle:PhysiqueAngle)=>{
  const photo=set?.photos.find(item=>item.angle===angle);
  return photo?`/api/photos/${photo.id}/content`:undefined;
};

export interface PhotoSetViewerProps{
  sets:PhysiquePhotoSet[];
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
    <PhotoFrame src={photoSrc(current,angle)} alt={`${angleLabel(angle)} physique photo from ${current.date}`}
      emptyTitle={angleLabel(angle)} emptyText="Not uploaded"
      preloadSrc={photoSrc(sets[index+1],angle)??photoSrc(sets[index-1],angle)} onOlder={older} onNewer={newer}/>
    <RecordNavigator noun="Set" index={index} total={sets.length} moreOlder={hasMore} date={current.date} busy={busy} onOlder={older} onNewer={newer}/>
  </section>;
}

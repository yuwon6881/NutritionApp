import type {BodyMeasurementKey,BodyRecord,PhysiqueAngle} from '../../types';
import {number} from '../../lib/format';
import {displayWeight,weightLabel} from '../../lib/units';
import {angleLabel,angles,measurementGroups,measurementLabel} from '../../lib/bodyMeasurements';
import {SegmentedControl} from '../ui/SegmentedControl';
import {PhotoFrame} from './PhotoFrame';
import {RecordNavigator} from './RecordNavigator';

const photoSrc=(record:BodyRecord|undefined,angle:PhysiqueAngle)=>{
  const photo=record?.photos.find(item=>item.angle===angle&&item.status==='complete');
  return photo?'/api/photos/'+photo.id+'/content':undefined;
};

export interface BodyRecordViewerProps{
  records:BodyRecord[];
  index:number;
  angle:PhysiqueAngle;
  weightUnit:'kg'|'lb';
  onAngle:(angle:PhysiqueAngle)=>void;
  onIndex:(index:number)=>void;
}

/** One Body record with its photo, measurements (compared with the next older record), and weight context. */
export function BodyRecordViewer({records,index,angle,weightUnit,onAngle,onIndex}:BodyRecordViewerProps){
  const record=records[index];
  const previous=records[index+1];
  if(!record)return null;
  const onOlder=index+1<records.length?()=>onIndex(index+1):undefined;
  const onNewer=index>0?()=>onIndex(index-1):undefined;
  const pending=record.photos.find(item=>item.angle===angle)?.status==='pending';
  const difference=(key:BodyMeasurementKey)=>{
    const current=record.measurements[key];const older=previous?.measurements[key];
    return current==null||older==null?null:current-older;
  };
  return <section className="panel body-viewer-panel">
    <div className="section-heading"><div><h2>{record.date}</h2><p>{record.weightContext.provenance==='legacy-unavailable'?'Weight snapshot unavailable':'Weight snapshot captured when saved'}{previous?' · Changes since '+previous.date:''}</p></div></div>
    <div className="body-viewer-layout">
      <div className="body-viewer-photo-column">
        <SegmentedControl<PhysiqueAngle> className="photo-angle-selector" label="Photo angle" value={angle} onChange={onAngle} options={angles.map(value=>({value,label:angleLabel(value)}))}/>
        <PhotoFrame src={photoSrc(record,angle)} alt={angleLabel(angle)+' physique photo from '+record.date}
          emptyTitle={angleLabel(angle)} emptyText={pending?'Upload pending':'Not uploaded'}
          preloadSrc={photoSrc(records[index+1],angle)??photoSrc(records[index-1],angle)} onOlder={onOlder} onNewer={onNewer}/>
        <RecordNavigator noun="Record" index={index} total={records.length} date={record.date} onOlder={onOlder} onNewer={onNewer}/>
      </div>
      <div className="body-measurement-summary">
        <div className="body-summary-heading"><h3>Measurements</h3><span>cm</span></div>
        {measurementGroups.map(([group,keys])=><div className="body-measurement-group" key={group}><h4>{group}</h4>{keys.map(key=><MeasurementLine key={key} label={measurementLabel(key)} value={record.measurements[key]} difference={difference(key)}/>)}</div>)}
        <div className="body-measurement-group"><h4>Composition</h4><MeasurementLine label="Body fat" value={record.measurements.bodyFatPercent} difference={difference('bodyFatPercent')} suffix="%" bodyFat/></div>
        <div className="body-weight-context"><h4>Weight context</h4>
          <p>Scale {record.weightContext.scaleKg==null?'—':displayWeight(record.weightContext.scaleKg,weightUnit,1)+' '+weightLabel(weightUnit)}{record.weightContext.scaleDate?' · '+record.weightContext.scaleDate:''}</p>
          <p>Trend {record.weightContext.trendKg==null?'—':displayWeight(record.weightContext.trendKg,weightUnit,1)+' '+weightLabel(weightUnit)}{record.weightContext.trendDate?' · '+record.weightContext.trendDate:''}</p>
        </div>
      </div>
    </div>
  </section>;
}

function MeasurementLine({label,value,difference,suffix='',bodyFat=false}:{label:string;value:number|null;difference:number|null;suffix?:string;bodyFat?:boolean}){
  const delta=difference==null?'':(difference>0?'+':'')+number(difference,1)+(bodyFat?' pp':'');
  return <div className="body-measurement-line"><span>{label}</span><span className="body-measurement-value">
    {delta&&<small className="body-measurement-difference">{delta}</small>}
    <strong>{value==null?'—':number(value,1)+suffix}</strong>
  </span></div>;
}

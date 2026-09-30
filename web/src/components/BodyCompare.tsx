import {Fragment,useState} from 'react';
import {ArrowLeft,ArrowLeftRight,Calendar,Scale} from 'lucide-react';
import type {BodyMeasurementKey,BodyRecord,PhysiqueAngle} from '../types';
import {Button} from './ui/Button';
import {SegmentedControl} from './ui/SegmentedControl';
import {displayWeight,weightLabel} from '../lib/units';
import {number} from '../lib/format';
import {angleLabel,angles,measurementGroups,measurementLabel} from '../lib/bodyMeasurements';
import {CompareOverlay} from './CompareOverlay';
import {CompareRecordPicker} from './body/CompareRecordPicker';
import {windowTier} from '../lib/breakpoints';

type CompareMode='all'|'photos'|'measurements';

export interface BodyCompareProps{
  records:BodyRecord[];
  initialPastIndex?:number;
  initialPresentIndex?:number;
  weightUnit:'kg'|'lb';
  onBack:()=>void;
  onEditRecord:(record:BodyRecord)=>void;
}

const signed=(value:number,digits:number)=>(value>0?'+':'')+number(value,digits);

export function BodyCompare({records,initialPastIndex,initialPresentIndex,weightUnit,onBack,onEditRecord}:BodyCompareProps){
  // Sorted descending (newest first).
  const sorted=[...records].sort((a,b)=>b.date.localeCompare(a.date));
  const defaultPresentId=sorted[initialPresentIndex??0]?.id??sorted[0]?.id??'';
  const defaultPastId=sorted[initialPastIndex??(sorted.length>1?sorted.length-1:0)]?.id??sorted[1]?.id??sorted[0]?.id??'';

  const [presentId,setPresentId]=useState(defaultPresentId);
  // Phones default to the overlay: two stacked thumbnails are too far apart to compare.
  const [photoLayout,setPhotoLayout]=useState<'overlay'|'side'>(()=>typeof window!=='undefined'&&windowTier(window.innerWidth)==='compact'?'overlay':'side');
  const [pastId,setPastId]=useState(defaultPastId);
  const [angle,setAngle]=useState<PhysiqueAngle>('front');
  const [mode,setMode]=useState<CompareMode>('all');
  const [unit,setUnit]=useState<'cm'|'in'>('cm');

  const presentRecord=sorted.find(r=>r.id===presentId)??sorted[0];
  const pastRecord=sorted.find(r=>r.id===pastId)??(sorted.length>1?sorted[sorted.length-1]:sorted[0]);
  const backButton=<Button variant="tertiary" size="sm" className="subpage-back-button" onClick={onBack}><ArrowLeft size={16} aria-hidden="true"/>Back to Body history</Button>;

  if(sorted.length<2){
    return <section className="panel body-compare-panel">
      <header className="page-heading photo-view-heading"><div className="subpage-header-title">{backButton}<h2>Compare records</h2></div></header>
      <div className="body-compare-empty">
        <Scale size={32} className="empty-icon" aria-hidden="true"/>
        <h3>At least 2 records required</h3>
        <p>Add another record to compare.</p>
        <Button variant="secondary" onClick={onBack}>Return to records</Button>
      </div>
    </section>;
  }

  const swapDates=()=>{setPresentId(pastId);setPastId(presentId);};
  const daysBetween=Math.abs(Math.round((new Date(presentRecord.date).getTime()-new Date(pastRecord.date).getTime())/(1000*60*60*24)));
  const presentPhoto=presentRecord.photos.find(p=>p.angle===angle&&p.status==='complete');
  const pastPhoto=pastRecord.photos.find(p=>p.angle===angle&&p.status==='complete');
  const bothPhotos=Boolean(pastPhoto&&presentPhoto);

  const scaleDiff=presentRecord.weightContext.scaleKg!=null&&pastRecord.weightContext.scaleKg!=null?presentRecord.weightContext.scaleKg-pastRecord.weightContext.scaleKg:null;
  const trendDiff=presentRecord.weightContext.trendKg!=null&&pastRecord.weightContext.trendKg!=null?presentRecord.weightContext.trendKg-pastRecord.weightContext.trendKg:null;
  const bfDiff=presentRecord.measurements.bodyFatPercent!=null&&pastRecord.measurements.bodyFatPercent!=null?presentRecord.measurements.bodyFatPercent-pastRecord.measurements.bodyFatPercent:null;

  const formatLength=(cm:number|null)=>cm==null?'—':number(unit==='in'?cm/2.54:cm,1)+' '+unit;
  const formatDelta=(key:BodyMeasurementKey)=>{
    const now=presentRecord.measurements[key];const prev=pastRecord.measurements[key];
    if(now==null||prev==null)return null;
    return {value:now-prev,text:signed(unit==='in'?(now-prev)/2.54:now-prev,1)+' '+unit};
  };
  const weight=(kg:number|null)=>kg!=null?displayWeight(kg,weightUnit,1)+' '+weightLabel(weightUnit):'—';

  const photoCard=(side:'Past'|'Present',record:BodyRecord,photo:typeof pastPhoto)=><article className="compare-photo-card">
    <div className="compare-photo-card-head">
      <span className={`tag ${side==='Past'?'past-tag':'present-tag'}`}>{side}</span>
      <strong>{record.date}</strong>
      <Button variant="tertiary" size="sm" onClick={()=>onEditRecord(record)} aria-label={`Edit ${side.toLowerCase()} record from ${record.date}`}>Edit</Button>
    </div>
    <div className="compare-photo-frame">
      {photo?<img key={photo.id} className="body-photo-frame-image" src={`/api/photos/${photo.id}/content`} alt={`${side} ${angleLabel(angle)} physique from ${record.date}`}/>:<div className="photo-slot-empty"><strong>{angleLabel(angle)}</strong><span>Not uploaded</span></div>}
    </div>
    <footer className="compare-photo-card-foot">
      <span>Scale: {weight(record.weightContext.scaleKg)}</span>
      <span>Trend: {weight(record.weightContext.trendKg)}</span>
      {record.measurements.bodyFatPercent!=null&&<span>Body fat: {number(record.measurements.bodyFatPercent,1)}%</span>}
    </footer>
  </article>;

  const row=(key:string,label:string,past:string,present:string,delta:{value:number;text:string}|null)=><tr key={key}>
    <th scope="row">{label}</th>
    <td data-label="Past">{past}</td>
    <td data-label="Present">{present}</td>
    <td data-label="Change">{delta?<span className={`compare-delta-badge ${delta.value<0?'negative':'positive'}`}>{delta.text}</span>:'—'}</td>
  </tr>;

  return <section className="panel body-compare-panel">
    <header className="page-heading photo-view-heading">
      <div className="subpage-header-title">{backButton}<h2>Side-by-side comparison</h2></div>
      <div className="body-compare-header-actions">
        <SegmentedControl<'cm'|'in'> id="compare-unit-toggle" label="Measurement unit" value={unit} onChange={setUnit} options={[{value:'cm',label:'cm'},{value:'in',label:'in'}]}/>
      </div>
    </header>

    <div className="body-compare-selectors-bar">
      <CompareRecordPicker role="Past" records={sorted} value={pastRecord.id} onChange={setPastId}/>
      <div className="compare-swap-col">
        <Button variant="tertiary" size="md" className="compare-swap-btn" aria-label="Swap past and present records" onClick={swapDates}>
          <ArrowLeftRight size={16} aria-hidden="true"/><span className="compare-swap-label">Swap dates</span>
        </Button>
      </div>
      <CompareRecordPicker role="Present" records={sorted} value={presentRecord.id} onChange={setPresentId}/>
    </div>

    <div className="body-compare-meta-strip">
      <span className="compare-days-badge"><Calendar size={14} aria-hidden="true"/>{daysBetween} {daysBetween===1?'day':'days'} apart</span>
      <div className="compare-meta-pills">
        {scaleDiff!=null&&<span className="compare-pill">Scale: <strong>{scaleDiff>0?'+':''}{displayWeight(scaleDiff,weightUnit,1)} {weightLabel(weightUnit)}</strong></span>}
        {trendDiff!=null&&<span className="compare-pill">Trend: <strong>{trendDiff>0?'+':''}{displayWeight(trendDiff,weightUnit,1)} {weightLabel(weightUnit)}</strong></span>}
        {bfDiff!=null&&<span className="compare-pill">Body fat: <strong>{signed(bfDiff,1)} pp</strong></span>}
      </div>
    </div>

    <SegmentedControl<CompareMode> className="section-segments compare-mode-segments" label="Comparison mode" value={mode} onChange={setMode} options={[{value:'all',label:'All'},{value:'photos',label:'Photos'},{value:'measurements',label:'Measurements'}]}/>

    {(mode==='all'||mode==='photos')&&<div className="compare-photos-section">
      <div className="section-heading">
        <div><h3>Physique comparison</h3><p>{bothPhotos&&photoLayout==='overlay'?'Move the divider':'Side-by-side view'} for the {angleLabel(angle).toLowerCase()} angle.</p></div>
        <SegmentedControl<PhysiqueAngle> className="photo-angle-selector" label="Photo angle" value={angle} onChange={setAngle} options={angles.map(a=>({value:a,label:angleLabel(a)}))}/>
      </div>
      {bothPhotos&&<SegmentedControl<'overlay'|'side'> className="section-segments compare-layout-segments" label="Photo layout" value={photoLayout} onChange={setPhotoLayout} options={[{value:'overlay',label:'Overlay'},{value:'side',label:'Side by side'}]}/>}
      {bothPhotos&&photoLayout==='overlay'&&<CompareOverlay pastSrc={`/api/photos/${pastPhoto!.id}/content`} presentSrc={`/api/photos/${presentPhoto!.id}/content`} pastLabel={`Past ${angleLabel(angle)} physique from ${pastRecord.date}`} presentLabel={`Present ${angleLabel(angle)} physique from ${presentRecord.date}`}/>}
      <div className="compare-photos-grid" hidden={bothPhotos&&photoLayout==='overlay'}>
        {photoCard('Past',pastRecord,pastPhoto)}
        {photoCard('Present',presentRecord,presentPhoto)}
      </div>
    </div>}

    {(mode==='all'||mode==='measurements')&&<div className="compare-measurements-section">
      <div className="section-heading"><div><h3>Circumference & body composition</h3><p>Change from {pastRecord.date} to {presentRecord.date}.</p></div></div>
      <div className="compare-table-wrap">
        <table className="compare-table">
          <thead><tr><th scope="col">Measurement</th><th scope="col">Past ({pastRecord.date})</th><th scope="col">Present ({presentRecord.date})</th><th scope="col">Change</th></tr></thead>
          <tbody>
            {measurementGroups.map(([group,keys])=><Fragment key={group}>
              <tr className="compare-table-group-header"><th colSpan={4} scope="colgroup">{group}</th></tr>
              {keys.map(key=>row(key,measurementLabel(key),formatLength(pastRecord.measurements[key]),formatLength(presentRecord.measurements[key]),formatDelta(key)))}
            </Fragment>)}
            <tr className="compare-table-group-header"><th colSpan={4} scope="colgroup">Composition</th></tr>
            {row('bodyFatPercent','Body fat',
              pastRecord.measurements.bodyFatPercent!=null?number(pastRecord.measurements.bodyFatPercent,1)+'%':'—',
              presentRecord.measurements.bodyFatPercent!=null?number(presentRecord.measurements.bodyFatPercent,1)+'%':'—',
              bfDiff!=null?{value:bfDiff,text:signed(bfDiff,1)+' pp'}:null)}
          </tbody>
        </table>
      </div>
    </div>}
  </section>;
}

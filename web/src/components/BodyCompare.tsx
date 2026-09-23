import {useState} from 'react';
import {ArrowLeft,ArrowLeftRight,Calendar,Scale,Camera} from 'lucide-react';
import type {BodyMeasurementKey,BodyRecord,PhysiqueAngle} from '../types';
import {Button} from './ui/Button';
import {SegmentedControl} from './ui/SegmentedControl';
import {SelectField} from './ui/Field';
import {displayWeight,weightLabel} from '../lib/units';
import {number} from '../lib/format';

const angles:PhysiqueAngle[]=['front','side','back'];
const angleLabel=(angle:PhysiqueAngle)=>angle[0].toUpperCase()+angle.slice(1);
const measurementGroups:[string,BodyMeasurementKey[]][]=[
  ['Core',['neckCm','shouldersCm','chestCm','waistCm','hipsCm']],
  ['Arms',['leftBicepsCm','rightBicepsCm','leftForearmCm','rightForearmCm']],
  ['Legs',['leftThighCm','rightThighCm','leftCalfCm','rightCalfCm']]
];
const measurementLabel=(key:BodyMeasurementKey)=>({
  neckCm:'Neck',shouldersCm:'Shoulders',chestCm:'Chest',waistCm:'Waist',hipsCm:'Hips',
  leftBicepsCm:'Left biceps',rightBicepsCm:'Right biceps',leftForearmCm:'Left forearm',rightForearmCm:'Right forearm',
  leftThighCm:'Left thigh',rightThighCm:'Right thigh',leftCalfCm:'Left calf',rightCalfCm:'Right calf',bodyFatPercent:'Body fat'
}[key]);

type CompareMode='all'|'photos'|'measurements';

export interface BodyCompareProps{
  records:BodyRecord[];
  initialPastIndex?:number;
  initialPresentIndex?:number;
  weightUnit:'kg'|'lb';
  onBack:()=>void;
  onEditRecord:(record:BodyRecord)=>void;
}

export function BodyCompare({records,initialPastIndex,initialPresentIndex,weightUnit,onBack,onEditRecord}:BodyCompareProps){
  // Sorted descending (newest first).
  const sorted=[...records].sort((a,b)=>b.date.localeCompare(a.date));
  const defaultPresentId=sorted[initialPresentIndex??0]?.id??sorted[0]?.id??'';
  const defaultPastId=sorted[initialPastIndex??(sorted.length>1?sorted.length-1:0)]?.id??sorted[1]?.id??sorted[0]?.id??'';

  const [presentId,setPresentId]=useState(defaultPresentId);
  const [pastId,setPastId]=useState(defaultPastId);
  const [angle,setAngle]=useState<PhysiqueAngle>('front');
  const [mode,setMode]=useState<CompareMode>('all');
  const [unit,setUnit]=useState<'cm'|'in'>('cm');

  const presentRecord=sorted.find(r=>r.id===presentId)??sorted[0];
  const pastRecord=sorted.find(r=>r.id===pastId)??(sorted.length>1?sorted[sorted.length-1]:sorted[0]);

  if(sorted.length<2){
    return <section className="panel body-compare-panel">
      <header className="page-heading photo-view-heading">
        <div className="subpage-header-title">
          <Button variant="tertiary" size="sm" className="subpage-back-button" onClick={onBack}>
            <ArrowLeft size={16} aria-hidden="true"/>Back
          </Button>
          <h2>Compare records</h2>
        </div>
      </header>
      <div className="body-compare-empty">
        <Scale size={32} className="empty-icon" aria-hidden="true"/>
        <h3>At least 2 records required</h3>
        <p>Add another body record with measurements or photos to compare changes over time.</p>
        <Button variant="secondary" onClick={onBack}>Return to records</Button>
      </div>
    </section>;
  }

  const swapDates=()=>{
    const temp=presentId;
    setPresentId(pastId);
    setPastId(temp);
  };

  const daysBetween=Math.abs(Math.round((new Date(presentRecord.date).getTime()-new Date(pastRecord.date).getTime())/(1000*60*60*24)));
  const presentPhoto=presentRecord?.photos.find(p=>p.angle===angle&&p.status==='complete');
  const pastPhoto=pastRecord?.photos.find(p=>p.angle===angle&&p.status==='complete');

  const scaleDiff=presentRecord?.weightContext.scaleKg!=null&&pastRecord?.weightContext.scaleKg!=null
    ?presentRecord.weightContext.scaleKg-pastRecord.weightContext.scaleKg:null;
  const trendDiff=presentRecord?.weightContext.trendKg!=null&&pastRecord?.weightContext.trendKg!=null
    ?presentRecord.weightContext.trendKg-pastRecord.weightContext.trendKg:null;
  const bfDiff=presentRecord?.measurements.bodyFatPercent!=null&&pastRecord?.measurements.bodyFatPercent!=null
    ?presentRecord.measurements.bodyFatPercent-pastRecord.measurements.bodyFatPercent:null;

  const formatLength=(cm:number|null)=>{
    if(cm==null)return '—';
    const val=unit==='in'?cm/2.54:cm;
    return number(val,1)+' '+unit;
  };

  const formatDelta=(key:BodyMeasurementKey)=>{
    const now=presentRecord?.measurements[key];
    const prev=pastRecord?.measurements[key];
    if(now==null||prev==null)return null;
    const diff=now-prev;
    if(key==='bodyFatPercent')return (diff>0?'+':'')+number(diff,1)+' pp';
    const converted=unit==='in'?diff/2.54:diff;
    return (converted>0?'+':'')+number(converted,1)+' '+unit;
  };

  return <section className="panel body-compare-panel">
    <header className="page-heading photo-view-heading">
      <div className="subpage-header-title">
        <Button variant="tertiary" size="sm" className="subpage-back-button" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true"/>Back
        </Button>
        <h2>Side-by-side comparison</h2>
      </div>
      <div className="body-compare-header-actions">
        <SegmentedControl<'cm'|'in'> id="compare-unit-toggle" label="Measurement unit" value={unit} onChange={setUnit} options={[{value:'cm',label:'cm'},{value:'in',label:'in'}]}/>
      </div>
    </header>

    <div className="body-compare-selectors-bar">
      <div className="compare-picker-item">
        <span className="compare-picker-label">Past (Baseline)</span>
        <SelectField label="Past record" value={pastId} onChange={setPastId}>
          {sorted.map((rec,i)=><option key={rec.id} value={rec.id}>{rec.date}{i===sorted.length-1?' (Earliest)':''}</option>)}
        </SelectField>
      </div>

      <div className="compare-swap-col">
        <Button variant="tertiary" size="md" className="compare-swap-btn" aria-label="Swap past and present records" onClick={swapDates}>
          <ArrowLeftRight size={16} aria-hidden="true"/>
          <span className="compare-swap-label">Swap dates</span>
        </Button>
      </div>

      <div className="compare-picker-item">
        <span className="compare-picker-label">Present (Target)</span>
        <SelectField label="Present record" value={presentId} onChange={setPresentId}>
          {sorted.map((rec,i)=><option key={rec.id} value={rec.id}>{rec.date}{i===0?' (Latest)':''}</option>)}
        </SelectField>
      </div>
    </div>

    <div className="body-compare-meta-strip">
      <span className="compare-days-badge"><Calendar size={14} aria-hidden="true"/>{daysBetween} {daysBetween===1?'day':'days'} apart</span>
      <div className="compare-meta-pills">
        {scaleDiff!=null&&<span className="compare-pill">Scale: <strong>{scaleDiff>0?'+':''}{displayWeight(scaleDiff,weightUnit,1)} {weightLabel(weightUnit)}</strong></span>}
        {trendDiff!=null&&<span className="compare-pill">Trend: <strong>{trendDiff>0?'+':''}{displayWeight(trendDiff,weightUnit,1)} {weightLabel(weightUnit)}</strong></span>}
        {bfDiff!=null&&<span className="compare-pill">Body fat: <strong>{bfDiff>0?'+':''}{number(bfDiff,1)} pp</strong></span>}
      </div>
    </div>

    <SegmentedControl<CompareMode> className="section-segments compare-mode-segments" label="Comparison mode" value={mode} onChange={setMode} options={[{value:'all',label:'All'},{value:'photos',label:'Photos'},{value:'measurements',label:'Measurements'}]}/>

    {(mode==='all'||mode==='photos')&&<div className="compare-photos-section">
      <div className="section-heading">
        <div><h3>Physique comparison</h3><p>Side-by-side view for {angleLabel(angle)} angle.</p></div>
        <SegmentedControl<PhysiqueAngle> className="photo-angle-selector" label="Photo angle" value={angle} onChange={setAngle} options={angles.map(a=>({value:a,label:angleLabel(a)}))}/>
      </div>

      <div className="compare-photos-grid">
        <article className="compare-photo-card">
          <div className="compare-photo-card-head">
            <span className="tag past-tag">Past</span>
            <strong>{pastRecord.date}</strong>
            <Button variant="tertiary" size="sm" onClick={()=>onEditRecord(pastRecord)}>Edit</Button>
          </div>
          <div className="compare-photo-frame">
            {pastPhoto?<img src={`/api/photos/${pastPhoto.id}/content`} alt={`Past ${angleLabel(angle)} physique from ${pastRecord.date}`}/>:<div className="photo-slot-empty"><strong>{angleLabel(angle)}</strong><span>Not uploaded</span></div>}
          </div>
          <footer className="compare-photo-card-foot">
            <span>Scale: {pastRecord.weightContext.scaleKg!=null?displayWeight(pastRecord.weightContext.scaleKg,weightUnit,1)+' '+weightLabel(weightUnit):'—'}</span>
            <span>Trend: {pastRecord.weightContext.trendKg!=null?displayWeight(pastRecord.weightContext.trendKg,weightUnit,1)+' '+weightLabel(weightUnit):'—'}</span>
            {pastRecord.measurements.bodyFatPercent!=null&&<span>BF: {number(pastRecord.measurements.bodyFatPercent,1)}%</span>}
          </footer>
        </article>

        <article className="compare-photo-card">
          <div className="compare-photo-card-head">
            <span className="tag present-tag">Present</span>
            <strong>{presentRecord.date}</strong>
            <Button variant="tertiary" size="sm" onClick={()=>onEditRecord(presentRecord)}>Edit</Button>
          </div>
          <div className="compare-photo-frame">
            {presentPhoto?<img src={`/api/photos/${presentPhoto.id}/content`} alt={`Present ${angleLabel(angle)} physique from ${presentRecord.date}`}/>:<div className="photo-slot-empty"><strong>{angleLabel(angle)}</strong><span>Not uploaded</span></div>}
          </div>
          <footer className="compare-photo-card-foot">
            <span>Scale: {presentRecord.weightContext.scaleKg!=null?displayWeight(presentRecord.weightContext.scaleKg,weightUnit,1)+' '+weightLabel(weightUnit):'—'}</span>
            <span>Trend: {presentRecord.weightContext.trendKg!=null?displayWeight(presentRecord.weightContext.trendKg,weightUnit,1)+' '+weightLabel(weightUnit):'—'}</span>
            {presentRecord.measurements.bodyFatPercent!=null&&<span>BF: {number(presentRecord.measurements.bodyFatPercent,1)}%</span>}
          </footer>
        </article>
      </div>
    </div>}

    {(mode==='all'||mode==='measurements')&&<div className="compare-measurements-section">
      <div className="section-heading">
        <div><h3>Circumference & body composition</h3><p>Direct delta from {pastRecord.date} to {presentRecord.date}.</p></div>
      </div>

      <div className="compare-table-wrap">
        <table className="compare-table">
          <thead>
            <tr>
              <th scope="col">Measurement</th>
              <th scope="col">Past ({pastRecord.date})</th>
              <th scope="col">Present ({presentRecord.date})</th>
              <th scope="col">Difference</th>
            </tr>
          </thead>
          <tbody>
            {measurementGroups.map(([group,keys])=><>
              <tr key={group} className="compare-table-group-header">
                <th colSpan={4} scope="colgroup">{group}</th>
              </tr>
              {keys.map(key=>{
                const delta=formatDelta(key);
                return <tr key={key}>
                  <td>{measurementLabel(key)}</td>
                  <td>{formatLength(pastRecord.measurements[key])}</td>
                  <td>{formatLength(presentRecord.measurements[key])}</td>
                  <td>{delta?<span className={`compare-delta-badge ${delta.startsWith('-')?'negative':'positive'}`}>{delta}</span>:'—'}</td>
                </tr>;
              })}
            </>)}
            <tr className="compare-table-group-header"><th colSpan={4} scope="colgroup">Composition</th></tr>
            <tr>
              <td>Body fat (%)</td>
              <td>{pastRecord.measurements.bodyFatPercent!=null?number(pastRecord.measurements.bodyFatPercent,1)+'%':'—'}</td>
              <td>{presentRecord.measurements.bodyFatPercent!=null?number(presentRecord.measurements.bodyFatPercent,1)+'%':'—'}</td>
              <td>{bfDiff!=null?<span className={`compare-delta-badge ${bfDiff<0?'negative':'positive'}`}>{bfDiff>0?'+':''}{number(bfDiff,1)} pp</span>:'—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>}
  </section>;
}

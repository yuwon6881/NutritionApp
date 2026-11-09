import {useState} from 'react';
import {Camera, Images, ScanText, UploadCloud, Utensils} from 'lucide-react';
import {Button} from './ui/Button';
import './ai-photo-picker.css';

type Props={
  mode:'photo'|'label';
  isMobile:boolean;
  pending:boolean;
  onCamera:()=>void;
  onGallery:()=>void;
  onFile:(file:File)=>void;
};

/** A viewfinder stage with its corner marks; the icon names what the photo should frame. */
function Stage({mode,children}:{mode:'photo'|'label';children?:React.ReactNode}){
  const Icon=mode==='label'?ScanText:Utensils;
  return <div className="ai-capture-stage">
    <span className="ai-capture-corner tl" aria-hidden="true"/>
    <span className="ai-capture-corner tr" aria-hidden="true"/>
    <span className="ai-capture-corner bl" aria-hidden="true"/>
    <span className="ai-capture-corner br" aria-hidden="true"/>
    <span className="ai-capture-orb" aria-hidden="true"><Icon size={26}/></span>
    <p className="ai-capture-title">{mode==='label'?'Photograph the nutrition label':'Photograph your meal'}</p>
    <p className="ai-capture-hint">{mode==='label'?'Fill the frame with the table of values.':'Keep the whole plate in view, in good light.'}</p>
    {children}
  </div>;
}

/** The empty state of the photo and label modes: take a photo, or choose one (drag and drop on desktop). */
export function AiPhotoPicker({mode,isMobile,pending,onCamera,onGallery,onFile}:Props){
  const [dragging,setDragging]=useState(false);
  if(isMobile){
    return <div className="ai-capture" data-validation-focus>
      <Stage mode={mode}/>
      <div className="ai-capture-actions">
        <Button type="button" variant="primary" size="lg" className="ai-capture-action" disabled={pending} onClick={onCamera}>
          <Camera size={18} aria-hidden="true"/><span>Take photo</span>
        </Button>
        <Button type="button" variant="secondary" size="lg" className="ai-capture-action" disabled={pending} onClick={onGallery}>
          <Images size={18} aria-hidden="true"/><span>Upload photo</span>
        </Button>
      </div>
    </div>;
  }
  return <div className="ai-capture" data-validation-focus>
    <div
      className={`ai-capture-drop ${dragging?'dragging':''} ${pending?'disabled':''}`}
      role="button"
      tabIndex={pending?-1:0}
      onClick={onGallery}
      onDragOver={event=>{event.preventDefault();if(!pending)setDragging(true);}}
      onDragLeave={event=>{event.preventDefault();setDragging(false);}}
      onDrop={event=>{
        event.preventDefault();
        setDragging(false);
        const file=event.dataTransfer.files?.[0];
        if(!pending&&file)onFile(file);
      }}
      onKeyDown={event=>{
        if(event.target!==event.currentTarget)return;
        if(event.key==='Enter'||event.key===' '){event.preventDefault();onGallery();}
      }}
    >
      <Stage mode={mode}>
        <span className="ai-capture-drop-cta"><UploadCloud size={16} aria-hidden="true"/>Choose a photo or drag &amp; drop</span>
      </Stage>
    </div>
  </div>;
}

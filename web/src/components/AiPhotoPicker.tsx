import {useState} from 'react';
import {Camera, Images, UploadCloud} from 'lucide-react';
import {Button} from './ui/Button';
import './ai-photo-picker.css';

type Props={
  isMobile:boolean;
  pending:boolean;
  onCamera:()=>void;
  onGallery:()=>void;
  onFile:(file:File)=>void;
};

/** The empty state of the photo and label modes: take a photo, or choose one (drag and drop on desktop). */
export function AiPhotoPicker({isMobile,pending,onCamera,onGallery,onFile}:Props){
  const [dragging,setDragging]=useState(false);
  if(isMobile){
    return <div className="ai-capture ai-capture-actions" data-validation-focus>
      <Button type="button" variant="primary" size="lg" className="ai-capture-action" disabled={pending} onClick={onCamera}>
        <Camera size={18} aria-hidden="true"/><span>Take photo</span>
      </Button>
      <Button type="button" variant="secondary" size="lg" className="ai-capture-action" disabled={pending} onClick={onGallery}>
        <Images size={18} aria-hidden="true"/><span>Upload photo</span>
      </Button>
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
      <UploadCloud size={18} aria-hidden="true"/>Choose a photo or drag &amp; drop
    </div>
  </div>;
}

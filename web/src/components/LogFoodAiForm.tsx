import {useCallback, useEffect, useRef, useState} from 'react';
import {Camera, Images, LoaderCircle, MessageSquareText, ScanText, Sparkles, UploadCloud, X} from 'lucide-react';
import type {FoodScanDraft} from '../lib/foodScans';
import {Button} from './ui/Button';
import {TextArea} from './ui/Field';
import {SegmentedControl} from './ui/SegmentedControl';
import {Form} from './ui/Form';
import {backCoordinator} from '../lib/appHistory';
import {isNativeApp} from '../lib/nativeApp';
import type {AiMode, PendingBarcode} from './useFoodScanDraft';

const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return isNativeApp() || !!window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 640;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const check = () => {
      setIsMobile(isNativeApp() || !!window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 640);
    };
    window.addEventListener('resize', check);
    const media = window.matchMedia?.('(pointer: coarse)');
    media?.addEventListener('change', check);
    return () => {
      window.removeEventListener('resize', check);
      media?.removeEventListener('change', check);
    };
  }, []);

  return isMobile;
};

/** AI logging from a description, meal photo, or nutrition label; results stay editable drafts. */
export function LogFoodAiForm({
  date,
  busy,
  pendingBarcode,
  mode,
  onModeChange,
  description,
  onDescriptionChange,
  photo,
  onPhotoFile,
  onClearPhoto,
  hasSavedReview,
  scanDraft,
  storageError,
  onSubmit,
  onBackToBarcode,
}:{
  date:string;
  busy:boolean;
  pendingBarcode?:PendingBarcode;
  mode:AiMode;
  onModeChange:(mode:AiMode)=>void;
  description:string;
  onDescriptionChange:(value:string)=>void;
  photo:string|null;
  onPhotoFile:(file:File)=>void;
  onClearPhoto?:()=>void;
  hasSavedReview:boolean;
  scanDraft:FoodScanDraft|null;
  storageError:string;
  onSubmit:()=>void;
  onBackToBarcode:()=>void;
}){
  const isMobile = useIsMobile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const cameraActiveRef = useRef(false);
  const unregisterCameraBack = useRef<(() => void) | null>(null);

  const disarmCameraGuard = useCallback(() => {
    cameraActiveRef.current = false;
    if (unregisterCameraBack.current) {
      unregisterCameraBack.current();
      unregisterCameraBack.current = null;
    }
  }, []);

  const armCameraGuard = useCallback(() => {
    if (cameraActiveRef.current || !isMobile || typeof window === 'undefined') return;
    cameraActiveRef.current = true;
    unregisterCameraBack.current = backCoordinator().register(() => {
      disarmCameraGuard();
    });
    const onFocus = () => {
      window.setTimeout(disarmCameraGuard, 350);
    };
    window.addEventListener('focus', onFocus, { once: true });
  }, [disarmCameraGuard, isMobile]);

  useEffect(() => {
    return () => {
      disarmCameraGuard();
    };
  }, [disarmCameraGuard]);

  useEffect(() => {
    const input = fileInputRef.current;
    if (!input) return;
    const onCancel = (e: Event) => {
      e.stopPropagation();
      disarmCameraGuard();
    };
    input.addEventListener('cancel', onCancel);
    return () => input.removeEventListener('cancel', onCancel);
  }, [disarmCameraGuard]);

  const triggerCamera = () => {
    const input = fileInputRef.current;
    if (!input || busy) return;
    armCameraGuard();
    input.setAttribute('capture', 'environment');
    input.click();
  };

  const triggerGallery = () => {
    const input = fileInputRef.current;
    if (!input || busy) return;
    armCameraGuard();
    input.removeAttribute('capture');
    try {
      input.click();
    } finally {
      if (isMobile) {
        input.setAttribute('capture', 'environment');
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    disarmCameraGuard();
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (file) onPhotoFile(file);
  };

  const handleCancel = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    disarmCameraGuard();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!busy) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) onPhotoFile(file);
  };

  const failed = scanDraft?.date === date && scanDraft.status === 'failed' && scanDraft.error;
  const interrupted = scanDraft?.error === 'Upload interrupted. Try again.';
  const submitLabel = busy ? 'Estimating…'
    : hasSavedReview ? 'Review saved estimate'
    : scanDraft?.status === 'failed' ? (interrupted ? 'Retry saved scan' : 'Try again')
    : scanDraft?.status === 'submitted' ? 'Resume saved scan'
    : mode === 'label' ? 'Read nutrition label' : 'Estimate my meal';

  return <Form onSubmit={onSubmit} className="ai-logging-form">
    {pendingBarcode && (
      <div className="section-heading">
        <div>
          <h3>Scan nutrition label</h3>
          <p>Barcode {pendingBarcode.code} · review the extracted values before saving.</p>
        </div>
        <Button type="button" variant="tertiary" onClick={onBackToBarcode}>Back to barcode</Button>
      </div>
    )}
    {!pendingBarcode && <h3>AI logging</h3>}
    {!pendingBarcode && (
      <SegmentedControl<AiMode>
        id="ai-log-mode"
        layout="equal"
        className="ai-mode-choice"
        label="How would you like to log?"
        value={mode}
        onChange={value => { if (!busy) onModeChange(value); }}
        options={[
          {value:'description', label:<><MessageSquareText size={18} aria-hidden="true"/><span>Describe</span></>, ariaLabel:'Describe my meal', disabled:busy&&mode!=='description'},
          {value:'photo', label:<><Camera size={18} aria-hidden="true"/><span>Photo</span></>, ariaLabel:'Meal photo', disabled:busy&&mode!=='photo'},
          {value:'label', label:<><ScanText size={18} aria-hidden="true"/><span>Label</span></>, ariaLabel:'Nutrition label', disabled:busy&&mode!=='label'},
        ]}
      />
    )}

    {mode === 'description' && (
      <TextArea
        id="ai-meal-description"
        name="description"
        disabled={busy}
        required
        label="Meal description and portions"
        maxLength={3000}
        value={description}
        onChange={event => onDescriptionChange(event.target.value)}
        placeholder="150 g coconut rice, one egg, sambal, cucumber, peanuts…"
      />
    )}

    {mode !== 'description' && (
      <>
        <label htmlFor="ai-photo-input" className="file-input-label sr-only">
          <span>{mode === 'label' ? 'Photograph the nutrition label' : 'Photograph your food'}</span>
        </label>
        <input
          ref={fileInputRef}
          id="ai-photo-input"
          name="photo"
          type="file"
          accept="image/*"
          aria-label={mode === 'label' ? 'Photograph the nutrition label' : 'Photograph your food'}
          capture={isMobile ? 'environment' : undefined}
          disabled={busy}
          className="accessible-native-file"
          tabIndex={-1}
          onChange={handleFileChange}
        />

        {isMobile ? (
          <div className="custom-file-dropzone ai-photo-mobile-controls" data-validation-focus>
            <div className="ai-photo-mobile-buttons">
              <Button
                type="button"
                variant="secondary"
                className="ai-photo-btn ai-photo-btn-camera"
                disabled={busy}
                onClick={triggerCamera}
              >
                <Camera size={18} aria-hidden="true" />
                <span>{photo ? 'Retake photo' : 'Take photo'}</span>
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="ai-photo-btn ai-photo-btn-gallery"
                disabled={busy}
                onClick={triggerGallery}
              >
                <Images size={18} aria-hidden="true" />
                <span>{photo ? 'Upload another' : 'Upload photo'}</span>
              </Button>
            </div>
          </div>
        ) : (
          !photo ? (
            <div
              className={`custom-file-dropzone ai-photo-desktop-dropzone ${isDragging ? 'dragging' : ''} ${busy ? 'disabled' : ''}`}
              onClick={triggerGallery}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              data-validation-focus
              role="button"
              tabIndex={busy ? -1 : 0}
              onKeyDown={e => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  triggerGallery();
                }
              }}
            >
              <UploadCloud size={24} className="dropzone-icon" />
              <span className="dropzone-main-text">Choose a photo or drag & drop</span>
            </div>
          ) : (
            <div className="ai-photo-desktop-controls">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={triggerGallery}
              >
                <UploadCloud size={16} aria-hidden="true" />
                <span>Change photo</span>
              </Button>
            </div>
          )
        )}

        {photo && (
          <div className="ai-photo-card">
            <figure className="ai-photo-preview">
              <img
                src={`data:image/jpeg;base64,${photo}`}
                alt={mode === 'label' ? 'Selected nutrition label photo' : 'Selected meal photo'}
              />
              <div className="ai-photo-preview-bar">
                <figcaption>Location metadata removed · deleted after processing.</figcaption>
                {onClearPhoto && (
                  <Button
                    type="button"
                    variant="tertiary"
                    size="sm"
                    disabled={busy}
                    onClick={onClearPhoto}
                    aria-label="Remove photo"
                  >
                    <X size={14} aria-hidden="true" />
                    <span>Remove</span>
                  </Button>
                )}
              </div>
            </figure>
          </div>
        )}

        <TextArea
          id="ai-photo-details"
          name="details"
          disabled={busy}
          label="Details for the AI (optional)"
          rows={2}
          maxLength={3000}
          value={description}
          onChange={event => onDescriptionChange(event.target.value)}
        />
      </>
    )}

    {hasSavedReview && <p className="notice" role="status">This scan is saved on this device and ready for review.</p>}
    {failed && <p className="notice" role="status">{interrupted ? 'The photo is retained on this device. Retry will use the same scan identity.' : 'The previous scan failed. Try again to start a new scan; the failed request will not be duplicated.'}</p>}
    {busy && <p className="ai-busy-status" role="status">Estimating nutrients. This scan is saved on this device, so it can resume if the connection drops.</p>}
    {storageError && <p className="error" role="alert">{storageError}</p>}
    <div className="modal-actions">
      <Button variant="primary" disabled={busy || !!storageError} type="submit">
        {busy ? <LoaderCircle size={18} className="spin-icon" aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />}
        {submitLabel}
      </Button>
    </div>
  </Form>;
}

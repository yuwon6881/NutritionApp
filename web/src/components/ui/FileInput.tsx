import {FieldFrame} from './Form';
import {useId, useRef, useState, type ChangeEvent, type DragEvent, type InputHTMLAttributes} from 'react';
import {UploadCloud, FileImage, X} from 'lucide-react';

export interface FileInputProps {
  label: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  accept?: string;
  capture?: InputHTMLAttributes<HTMLInputElement>['capture'];
  disabled?: boolean;
  required?: boolean;
  hint?: string;
  validate?:()=>string|undefined;
  id?: string;
  name?: string;
  className?: string;
}

export function FileInput({
  label,
  onChange,
  accept = 'image/*',
  capture,
  disabled = false,
  required = false,
  hint,
  validate,
  id: idProp,
  name: nameProp,
  className = '',
}: FileInputProps) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const name = nameProp ?? idProp ?? id;
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFileName(file.name);
    }
    onChange(e);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    const files = e.dataTransfer.files;
    if (files && files.length > 0 && inputRef.current) {
      inputRef.current.files = files;
      setSelectedFileName(files[0].name);
      // Trigger change event
      const event = new Event('change', {bubbles: true});
      inputRef.current.dispatchEvent(event);
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (inputRef.current) {
      inputRef.current.value = '';
      setSelectedFileName('');
      inputRef.current.dispatchEvent(new Event('change',{bubbles:true}));
    }
  };

  return (
    <FieldFrame label={label} validate={validate} className={`field file-input-field ${className}`.trim()}>
      <label htmlFor={id} className="file-input-label">
        <span>{label}</span>
      </label>

      <div
        className={`custom-file-dropzone ${isDragging ? 'dragging' : ''} ${
          selectedFileName ? 'has-file' : ''
        } ${disabled ? 'disabled' : ''}`}
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        data-validation-focus
        aria-label={`Upload ${label.toLowerCase()}`}
        aria-describedby={hint?`${id}-hint`:undefined}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        {/* Native file input associated with the label so screen readers and Playwright find it */}
        <input
          ref={inputRef}
          id={id}
          name={name}
          type="file"
          accept={accept}
          capture={capture}
          disabled={disabled}
          required={required}
          onChange={handleInputChange}
          className="accessible-native-file"
          tabIndex={-1}
        />

        {selectedFileName ? (
          <div className="file-preview-info">
            <FileImage size={22} className="file-preview-icon" />
            <span className="file-preview-name">{selectedFileName}</span>
            <button
              type="button"
              className="file-clear-btn"
              disabled={disabled}
              onClick={handleClear}
              aria-label="Remove selected file"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="dropzone-prompt">
            <UploadCloud size={24} className="dropzone-icon" />
            <span className="dropzone-main-text">Choose a photo or drag & drop</span>
            <small className="dropzone-subtext">JPEG or PNG, up to 750 KB</small>
          </div>
        )}
      </div>

      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </FieldFrame>
  );
}

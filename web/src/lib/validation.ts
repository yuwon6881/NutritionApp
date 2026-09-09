type ConstraintControl={value:string;type?:string;required?:boolean;minLength?:number;maxLength?:number;min?:string;max?:string;step?:string;validity:ValidityState};

/** Application copy; never read the browser's localized validationMessage. */
export function constraintMessage(control:ConstraintControl,label:string):string {
  const {value,validity}=control;
  if(validity.badInput)return control.type==='date'?'Choose a valid date.':control.type==='time'?'Enter a valid time.':'Enter a valid number.';
  if(validity.valueMissing||(control.required&&control.type!=='password'&&!value.trim())){
    const choose=['date','file','radio','select-one','select-multiple'].includes(control.type??'');
    return `${choose?'Choose':'Enter'} ${label.toLowerCase()}.`;
  }
  if(!value)return '';
  if(control.minLength!=null&&control.minLength>0&&value.length<control.minLength)return `Use at least ${control.minLength} characters.`;
  if(control.maxLength!=null&&control.maxLength>=0&&value.length>control.maxLength)return `Use no more than ${control.maxLength} characters.`;
  if(validity.rangeUnderflow)return control.type==='date'?`Choose ${control.min} or later.`:`Enter ${control.min} or more.`;
  if(validity.rangeOverflow)return control.type==='date'?`Choose ${control.max} or earlier.`:`Enter ${control.max} or less.`;
  if(validity.stepMismatch)return `Use increments of ${control.step||'1'}.`;
  if(validity.typeMismatch)return control.type==='email'?'Enter a valid email address.':'Enter a valid value.';
  if(validity.patternMismatch)return 'Use the requested format.';
  return validity.valid?'':'Check this value.';
}

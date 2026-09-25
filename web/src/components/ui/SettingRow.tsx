import type {ReactNode} from 'react';

/**
 * One label-and-control line inside a settings card. The text column is the only flexible track, so
 * a long label wraps instead of colliding with its control; below 640 px the control drops beneath
 * the text and fills the row.
 */
export function SettingRow({label,description,id,className='',children}:{
  label:ReactNode;
  description?:ReactNode;
  id?:string;
  className?:string;
  children?:ReactNode;
}){
  return <div className={`setting-row ${className}`.trim()} id={id}>
    <div className="setting-row-text">
      <span className="setting-row-label">{label}</span>
      {description&&<span className="setting-row-description">{description}</span>}
    </div>
    {children&&<div className="setting-row-control">{children}</div>}
  </div>;
}

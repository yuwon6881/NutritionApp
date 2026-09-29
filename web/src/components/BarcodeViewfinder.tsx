import {forwardRef} from 'react';

/**
 * Barcode-shaped aiming frame shared by the in-page camera and the Android
 * scanner overlay. The faint bar silhouette shows which way to hold the pack;
 * QR codes are still read anywhere inside the frame.
 */
const BARS=[3,1,2,1,1,3,1,2,2,1,1,3,2,1,1,2,3,1,1,2,1,3];

export const BarcodeViewfinder=forwardRef<HTMLDivElement,{detected?:boolean}>(function BarcodeViewfinder({detected=false},ref){
  return <div ref={ref} className={`barcode-frame${detected?' detected':''}`} aria-hidden="true">
    <i/><i/><i/><i/>
    <span className="barcode-silhouette">{BARS.map((width,index)=><b key={index} style={{flexGrow:width}}/>)}</span>
    <span className="barcode-guide"/>
  </div>;
});

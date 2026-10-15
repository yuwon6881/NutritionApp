import {expect,it} from 'vitest';
import {firstProductCode} from './frameDecoder';
import {selectTargetedProduct} from './nativeTargeting';

it('keeps UPC expansion inside the targeted native frame',()=>{
  const bounds={left:0,top:0,width:100,height:100};
  expect(selectTargetedProduct([
    {rawValue:'04252614',format:'UPC_E',cornerPoints:[[40,40],[60,40],[60,60],[40,60]]},
  ],{imageWidth:100,imageHeight:100,preview:bounds,webview:bounds},bounds,bounds)).toBe('042100005264');
});

it('reads a GS1 Digital Link QR from the browser detector',()=>{
  expect(firstProductCode([{rawValue:'https://id.gs1.org/01/04006381333931',format:'qr_code'}])).toBe('4006381333931');
  expect(firstProductCode([{rawValue:'4006381333932',format:'ean_13'}])).toBeNull();
});

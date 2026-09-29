import {expect,it} from 'vitest';
import {firstProductCode} from './frameDecoder';
import {productCodeFromDetections} from './nativeScanner';

it('takes the first product number from an ML Kit batch and skips unrelated QR codes',()=>{
  expect(productCodeFromDetections([
    {rawValue:'https://brand.example/promo',format:'QR_CODE'},
    {rawValue:'04252614',format:'UPC_E'},
  ])).toBe('042100005264');
  expect(productCodeFromDetections([{rawValue:'https://brand.example/promo',format:'QR_CODE'}])).toBeNull();
  expect(productCodeFromDetections([{format:'EAN_13'}])).toBeNull();
});

it('reads a GS1 Digital Link QR from the browser detector',()=>{
  expect(firstProductCode([{rawValue:'https://id.gs1.org/01/04006381333931',format:'qr_code'}])).toBe('4006381333931');
  expect(firstProductCode([{rawValue:'4006381333932',format:'ean_13'}])).toBeNull();
});

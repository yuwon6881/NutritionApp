import {describe,expect,it} from 'vitest';
import {expandUpcE,hasValidCheckDigit,productCodeFromScan} from './productCode';

describe('productCodeFromScan',()=>{
  it('keeps valid linear retail codes',()=>{
    expect(productCodeFromScan('4006381333931','ean_13')).toBe('4006381333931');
    expect(productCodeFromScan('96385074','ean_8')).toBe('96385074');
    expect(productCodeFromScan('036000291452','upc_a')).toBe('036000291452');
  });

  it('rejects misreads that fail the GS1 check digit',()=>{
    expect(productCodeFromScan('4006381333932','ean_13')).toBeNull();
    expect(productCodeFromScan('12345','unknown')).toBeNull();
  });

  it('expands UPC-E to the UPC-A the catalogue stores',()=>{
    expect(productCodeFromScan('04252614','upc_e')).toBe('042100005264');
    // The same eight digits read as EAN-8 are a different product number.
    expect(productCodeFromScan('96385074','ean_8')).toBe('96385074');
  });

  it('reads the GTIN from a GS1 Digital Link QR code',()=>{
    expect(productCodeFromScan('https://id.gs1.org/01/09506000134352/10/ABC','qr_code')).toBe('9506000134352');
    expect(productCodeFromScan('https://brand.example/product/01/09506000134352?11=221231','qr_code')).toBe('9506000134352');
  });

  it('reads the GTIN from a GS1 element string',()=>{
    expect(productCodeFromScan('(01)09506000134352(17)281231','qr_code')).toBe('9506000134352');
    expect(productCodeFromScan('\u001d010950600013435217281231','qr_code')).toBe('9506000134352');
  });

  it('rejects QR codes that do not carry a product number',()=>{
    expect(productCodeFromScan('https://brand.example/promo','qr_code')).toBeNull();
    expect(productCodeFromScan('https://id.gs1.org/01/09506000134353','qr_code')).toBeNull();
  });
});

describe('GS1 helpers',()=>{
  it('validates check digits for every GTIN length',()=>{
    expect(hasValidCheckDigit('96385074')).toBe(true);
    expect(hasValidCheckDigit('036000291452')).toBe(true);
    expect(hasValidCheckDigit('09506000134352')).toBe(true);
    expect(hasValidCheckDigit('123456789')).toBe(false);
  });

  it('expands each UPC-E compression pattern',()=>{
    expect(expandUpcE('01234505')).toBe('012000003455');
    expect(expandUpcE('04252614')).toBe('042100005264');
    expect(expandUpcE('23456781')).toBeNull();
  });
});

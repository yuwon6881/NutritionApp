/**
 * Turns whatever a scanner decoded into the retail product number the food
 * catalogue is keyed by, or null when the code does not identify a product.
 *
 * Packaging carries the product number (GTIN) in several shapes: a linear
 * EAN/UPC barcode, a compressed UPC-E barcode, or a QR code holding a GS1
 * Digital Link URL or a GS1 element string. Anything else — a website QR, a
 * loyalty code, a misread — is rejected so it never reaches a lookup.
 */
export type ScannedFormat='ean_13'|'ean_8'|'upc_a'|'upc_e'|'qr_code'|'unknown';

/** GS1 modulo-10 check digit over the leading digits of a GTIN-8/12/13/14. */
export function hasValidCheckDigit(code:string){
  if(!/^(\d{8}|\d{12,14})$/.test(code))return false;
  const digits=[...code].map(Number);
  const check=digits.pop()!;
  const sum=digits.reverse().reduce((total,digit,index)=>total+digit*(index%2===0?3:1),0);
  return (10-sum%10)%10===check;
}

/** Expands an 8-digit UPC-E (number system, six data digits, check) to UPC-A. */
export function expandUpcE(code:string):string|null{
  if(!/^[01]\d{7}$/.test(code))return null;
  const system=code[0];
  const data=code.slice(1,7);
  const check=code[7];
  const last=data[5];
  let body:string;
  if(last==='0'||last==='1'||last==='2')body=`${data.slice(0,2)}${last}0000${data.slice(2,5)}`;
  else if(last==='3')body=`${data.slice(0,3)}00000${data.slice(3,5)}`;
  else if(last==='4')body=`${data.slice(0,4)}00000${data[4]}`;
  else body=`${data.slice(0,5)}0000${last}`;
  const expanded=`${system}${body}${check}`;
  return hasValidCheckDigit(expanded)?expanded:null;
}

/** A GTIN-14 with a zero indicator is the same product as its GTIN-13. */
function canonicalGtin(code:string){
  return code.length===14&&code.startsWith('0')?code.slice(1):code;
}

/** Extracts the GTIN from a GS1 Digital Link URL or GS1 element string. */
function gtinFromGs1(text:string):string|null{
  const link=/^https?:\/\/[^/\s]+(?:\/[^\s]*)?\/01\/(\d{8,14})(?:[/?#]|$)/i.exec(text);
  if(link)return link[1].padStart(14,'0');
  const bracketed=/^\(01\)(\d{14})/.exec(text);
  if(bracketed)return bracketed[1];
  // An unbracketed element string may be prefixed by the FNC1 group separator.
  const raw=/^\u001d?01(\d{14})/.exec(text);
  return raw?raw[1]:null;
}

export function productCodeFromScan(rawValue:string,format:ScannedFormat='unknown'):string|null{
  const text=rawValue.trim();
  if(format==='upc_e'){
    const expanded=expandUpcE(text);
    if(expanded)return expanded;
  }
  if(/^\d+$/.test(text))return hasValidCheckDigit(text)?canonicalGtin(text):null;
  const gtin=gtinFromGs1(text);
  return gtin&&hasValidCheckDigit(gtin)?canonicalGtin(gtin):null;
}

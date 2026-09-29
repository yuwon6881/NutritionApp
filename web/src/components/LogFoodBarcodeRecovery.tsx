import {Button} from './ui/Button';

export type BarcodeRecovery={code:string;status:number;message:string};

/** Explains why a scanned barcode could not be used and offers every private recovery path. */
export function LogFoodBarcodeRecovery({recovery,onRetry,onLink,onLabel,onManual}:{
  recovery:BarcodeRecovery;
  onRetry:()=>void;
  onLink:()=>void;
  onLabel:()=>void;
  onManual:()=>void;
}){
  const {code,status}=recovery;
  return <section className="notice barcode-recovery" aria-labelledby="barcode-recovery-title">
    <h4 id="barcode-recovery-title">{status===404?'Barcode not found in the food databases':status===422?'Product data is incomplete':'Food databases are temporarily unavailable'}</h4>
    <p>{status===404
      ?`No catalogue entry was found for ${code}. The camera decoded the barcode; choose how to recover this product.`
      :status===422
      ?`The product at ${code} is missing reliable nutrition details. You can provide the label or use one of your saved foods.`
      :`The food databases could not be reached for ${code}. Retry when connected, or use a private saved-food or manual recovery.`}</p>
    <div className="actions">
      {status!==404&&<Button variant="secondary" onClick={onRetry}>Retry lookup</Button>}
      <Button onClick={onLink}>Link an existing food</Button>
      <Button onClick={onLabel}>Scan nutrition label</Button>
      <Button onClick={onManual}>Enter manually</Button>
    </div>
  </section>;
}

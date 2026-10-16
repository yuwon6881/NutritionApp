import type {FoodSearchResult} from '../types';
import {verifiableCodes} from './foodVerification';

// One additional bulk attempt may wait out the provider's 6.1-second paced slot.
export const VERIFY_RETRY_MS=6500;
export const VERIFY_COOLDOWN_MS=30000;
type Attempt={count:number;pending:boolean;retryAt:number;timer?:ReturnType<typeof setTimeout>};

/** Bounded recovery for a visible query, including unresolved rows returned from its cache. */
export class FoodVerificationRecovery {
  private readonly attempts=new Map<string,Attempt>();
  private disposed=false;

  constructor(private readonly handlers:{
    read:(codes:string[])=>Promise<FoodSearchResult[]>;
    results:(key:string)=>FoodSearchResult[];
    apply:(key:string,verified:FoodSearchResult[])=>void;
    active:(key:string)=>boolean;
    /** Reports whether a query's unresolved rows are being confirmed now or waiting for their retry. */
    changed?:(key:string,confirming:boolean)=>void;
  }){}

  confirm(key:string){
    if(this.disposed||!this.handlers.active(key))return;
    const codes=verifiableCodes(this.handlers.results(key));
    if(codes.length===0)return;
    let attempt=this.attempts.get(key);
    if(attempt?.pending||attempt&&Date.now()<attempt.retryAt)return;
    if(!attempt||attempt.count>=2){
      attempt={count:0,pending:false,retryAt:0};
      this.attempts.set(key,attempt);
    }
    if(attempt.timer)clearTimeout(attempt.timer);
    attempt.count++;
    attempt.pending=true;
    this.handlers.changed?.(key,true);
    const current=attempt;
    void this.handlers.read(codes)
      .then(verified=>this.handlers.apply(key,verified))
      .catch(()=>{/* The row remains selectable; recovery never presents unconfirmed numbers. */})
      .finally(()=>{
        current.pending=false;
        const unresolved=verifiableCodes(this.handlers.results(key)).length>0;
        if(!unresolved||this.disposed){this.handlers.changed?.(key,false);return;}
        const delay=current.count<2?VERIFY_RETRY_MS:VERIFY_COOLDOWN_MS;
        current.retryAt=Date.now()+delay;
        if(current.count<2){
          // The rows stay "confirming" through the wait, so a failed first attempt does not flash the plain text.
          current.timer=setTimeout(()=>{current.timer=undefined;this.confirm(key);},delay);
        }else this.handlers.changed?.(key,false);
      });
  }

  dispose(){
    this.disposed=true;
    for(const attempt of this.attempts.values())if(attempt.timer)clearTimeout(attempt.timer);
    this.attempts.clear();
  }
}

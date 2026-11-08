import type {AppState,Mutation} from '../types';
import {shiftDate} from './energyBalance';
import {today} from './format';
export function validateFoodDestination(state:AppState,operation:Omit<Mutation,'id'>):void{
  if(operation.kind!=='entry')return;
  const date=(operation.data as {date?:string}).date;
  if(!date||date<'2000-01-01'||date>shiftDate(today(state.profile?.timeZone),1))throw new Error('Choose a date through tomorrow.');
}

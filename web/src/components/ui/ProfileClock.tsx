import {createContext,useContext,useMemo,type ReactNode} from 'react';
import {today} from '../../lib/format';
import {mealTime} from '../../lib/foodDiary';

/** "Now" in the account's profile time zone, so the pickers agree with the day the diary is on. */
export interface ProfileClock{
  /** Today as YYYY-MM-DD. */
  today:()=>string;
  /** The current time as HH:mm (24-hour). */
  time:()=>string;
}

const pad=(value:number)=>String(value).padStart(2,'0');

/** Used where no profile zone is provided (isolated components and tests): the device's own clock. */
const deviceClock:ProfileClock={
  today:()=>{const now=new Date();return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;},
  time:()=>{const now=new Date();return `${pad(now.getHours())}:${pad(now.getMinutes())}`;}
};

const Context=createContext<ProfileClock>(deviceClock);

export function ProfileClockProvider({zone,children}:{zone:string|undefined;children:ReactNode}){
  const clock=useMemo<ProfileClock>(()=>zone?{today:()=>today(zone),time:()=>mealTime(zone)}:deviceClock,[zone]);
  return <Context.Provider value={clock}>{children}</Context.Provider>;
}

export const useProfileClock=()=>useContext(Context);

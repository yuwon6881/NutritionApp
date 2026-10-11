import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ProfileClockProvider,useProfileClock} from './ProfileClock';

function Probe(){
  const clock=useProfileClock();
  return createElement('p',null,`${clock.today()} ${clock.time()}`);
}
const render=(zone:string|undefined)=>renderToStaticMarkup(createElement(ProfileClockProvider,{zone,children:createElement(Probe)}));

describe('ProfileClock',()=>{
  beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-11T20:30:00Z'));});
  afterEach(()=>vi.useRealTimers());

  it('reads the day and time in the profile zone, not the device zone',()=>{
    // 20:30 UTC is already the next morning in Kuala Lumpur and still the same afternoon in Honolulu.
    expect(render('Asia/Kuala_Lumpur')).toContain('2026-10-12 04:30');
    expect(render('Pacific/Honolulu')).toContain('2026-10-11 10:30');
  });

  it('falls back to the device clock when no profile zone is known yet',()=>{
    const now=new Date();
    const pad=(value:number)=>String(value).padStart(2,'0');
    expect(render(undefined)).toContain(`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`);
  });
});

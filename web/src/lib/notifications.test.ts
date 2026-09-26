import {describe,expect,it,vi,beforeEach} from 'vitest';
import {api} from './api';
import {activateCheckInReminder} from './notifications';

vi.mock('./api',()=>({api:vi.fn()}));
const reminder={enabled:false,weekday:1,localTime:'19:00',timeZoneId:'Asia/Kuala_Lumpur'};

describe('combined reminder enablement',()=>{
  beforeEach(()=>vi.clearAllMocks());
  it('subscribes before saving the enabled schedule',async()=>{
    const order:string[]=[];
    vi.mocked(api).mockImplementationOnce(async()=>{order.push('save');return {...reminder,enabled:true};});
    await expect(activateCheckInReminder(reminder,async()=>{order.push('subscribe');})).resolves.toEqual({...reminder,enabled:true});
    expect(order).toEqual(['subscribe','save']);
    expect(api).toHaveBeenCalledWith('/notifications/check-in-reminder',{...reminder,enabled:true},'POST');
  });
  it.each(['Permission denied','Device registration failed'])('does not enable the account after %s',async message=>{
    await expect(activateCheckInReminder(reminder,async()=>{throw new Error(message);})).rejects.toThrow(message);
    expect(api).not.toHaveBeenCalled();
  });
  it('reports a successful subscription separately from a failed schedule save',async()=>{
    vi.mocked(api).mockRejectedValueOnce(new Error('Network unavailable'));
    await expect(activateCheckInReminder(reminder,async()=>{})).rejects.toThrow('This device is subscribed, but the reminder could not be saved. Network unavailable');
  });
});

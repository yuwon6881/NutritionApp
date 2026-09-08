import {describe,it,expect} from 'vitest';
import {energyDays,groupEnergy} from './energyBalance';
describe('energy balance history',()=>{
  it('uses effective dated maintenance and suppresses balance for incomplete days',()=>{
    const rows=energyDays({entries:[{date:'2026-09-01',calories:2000,deleted:false},{date:'2026-09-02',calories:1200,deleted:false}],days:[{date:'2026-09-01',status:'complete',deleted:false},{date:'2026-09-02',status:'not_logged',deleted:false},{date:'2026-09-03',status:'fasting',deleted:false}],estimates:[{date:'2026-09-01',revision:1,expenditure:2500},{date:'2026-09-03',revision:2,expenditure:2300}]},'2026-09-01','2026-09-03');
    expect(rows.map(r=>r.balance)).toEqual([-500,null,-2300]);expect(rows[1].intake).toBe(1200);
    expect(groupEnergy(rows,'month')[0].balance).toBeNull();
  });
  it('preserves archived totals and never guesses historical maintenance',()=>{
    const rows=energyDays({entries:[],days:[{date:'2026-09-01',status:'complete',deleted:false,archived:true,calories:2100,entryCount:20}],estimates:[]},'2026-09-01','2026-09-02');
    expect(rows[0].intake).toBe(2100);expect(rows[0].balance).toBeNull();expect(rows[1].intake).toBeNull();
  });
});

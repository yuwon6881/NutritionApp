import {expect,it} from 'vitest';
import {upgradeLocalDatabase} from './localSchema';

function schema(names:string[]){
  const stores=new Set(names);
  return {stores,db:{
    objectStoreNames:{contains:(name:string)=>stores.has(name)} as DOMStringList,
    createObjectStore:(name:string)=>{stores.add(name);return {} as IDBObjectStore;},
    deleteObjectStore:(name:string)=>{stores.delete(name);}
  }};
}
const current=['accounts','saved_foods','mutations','drafts','meta','food_drafts','food_scans','push_revocations','push_devices'];

it('creates every current store for a new install and never the retired dated-day cache',()=>{
  const {stores,db}=schema([]);
  upgradeLocalDatabase(db,0);
  expect([...stores].sort()).toEqual([...current].sort());
});

it('removes the write-only dated-day cache from an existing install and keeps every account store',()=>{
  const {stores,db}=schema([...current,'diary_days']);
  upgradeLocalDatabase(db,5);
  expect([...stores].sort()).toEqual([...current].sort());
});

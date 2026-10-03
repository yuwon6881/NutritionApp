import {describe,expect,it} from 'vitest';
import {LEGACY_LOCAL_STORAGE_KEYS,migrateLegacyLocalStorage} from './legacyStorage';

function memoryStorage(initial:Record<string,string>={},failWrites=false){
  const values=new Map(Object.entries(initial));
  return {
    values,
    getItem:(key:string)=>values.get(key)??null,
    setItem:(key:string,value:string)=>{if(failWrites)throw new DOMException('Quota exceeded','QuotaExceededError');values.set(key,value);},
    removeItem:(key:string)=>{values.delete(key);},
  };
}

describe('pre-rename localStorage keys',()=>{
  it('moves the session, theme, haptics, push device, and shortcut keys to their current names',()=>{
    const storage=memoryStorage({
      'nourish-account':'account-a',
      'nourish-signed-out':'1',
      'nourish-theme':'dark',
      'nourish-haptics':'off',
      'nourish-push-device-id':'device-1',
      'nourish-pending-shortcut-v1':'{"version":1}',
    });
    migrateLegacyLocalStorage(storage);
    expect(Object.fromEntries(storage.values)).toEqual({
      'nutrition-account':'account-a',
      'nutrition-signed-out':'1',
      'nutrition-theme':'dark',
      'nutrition-haptics':'off',
      'nutrition-push-device-id':'device-1',
      'nutrition-pending-shortcut-v1':'{"version":1}',
    });
  });

  it('keeps a value already stored under the current name',()=>{
    const storage=memoryStorage({'nourish-theme':'dark','nutrition-theme':'light'});
    migrateLegacyLocalStorage(storage);
    expect(Object.fromEntries(storage.values)).toEqual({'nutrition-theme':'light'});
  });

  it('keeps the old key when the new value cannot be stored',()=>{
    const storage=memoryStorage({'nourish-push-device-id':'device-1'},true);
    migrateLegacyLocalStorage(storage);
    expect(Object.fromEntries(storage.values)).toEqual({'nourish-push-device-id':'device-1'});
  });

  it('is a no-op once moved and lists every key the app reads',()=>{
    const storage=memoryStorage({'nutrition-account':'account-a'});
    migrateLegacyLocalStorage(storage);
    expect(Object.fromEntries(storage.values)).toEqual({'nutrition-account':'account-a'});
    expect(LEGACY_LOCAL_STORAGE_KEYS.map(([,current])=>current)).toEqual([
      'nutrition-account','nutrition-signed-out','nutrition-theme','nutrition-haptics','nutrition-push-device-id','nutrition-pending-shortcut-v1',
    ]);
  });
});

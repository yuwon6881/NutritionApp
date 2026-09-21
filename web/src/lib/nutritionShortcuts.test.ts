import {describe,expect,it} from 'vitest';
import {
  captureNutritionShortcut,
  clearPendingNutritionShortcut,
  consumePendingNutritionShortcut,
  consumeReadyNutritionShortcut,
  NUTRITION_SHORTCUTS,
} from './nutritionShortcuts';

function memoryStorage(){
  const values=new Map<string,string>();
  return {
    getItem:(key:string)=>values.get(key)??null,
    setItem:(key:string,value:string)=>{values.set(key,value);},
    removeItem:(key:string)=>{values.delete(key);},
    values,
  };
}

describe('Nutrition Home Screen shortcuts',()=>{
  it('declares the three existing quick-entry flows with stable in-scope URLs',()=>{
    expect(NUTRITION_SHORTCUTS.map(shortcut=>shortcut.action)).toEqual(['log-food','scan-barcode','log-weight']);
    for(const shortcut of NUTRITION_SHORTCUTS){
      expect(new URL(shortcut.url,'https://nutrition.example').origin).toBe('https://nutrition.example');
      expect(new URL(shortcut.url,'https://nutrition.example').pathname).toBe('/');
    }
  });

  it('captures a valid action once and preserves unrelated route state',()=>{
    const storage=memoryStorage();
    expect(captureNutritionShortcut('https://nutrition.example/food?nutritionAction=scan-barcode&date=2026-09-21#diary',storage,1000))
      .toEqual({action:'scan-barcode',cleanUrl:'/food?date=2026-09-21#diary'});
    expect(consumePendingNutritionShortcut(storage,1500)).toBe('scan-barcode');
    expect(consumePendingNutritionShortcut(storage,1500)).toBeNull();
  });

  it('keeps the action through sign-in and waits for authenticated profile readiness',()=>{
    const storage=memoryStorage();
    captureNutritionShortcut('/?nutritionAction=log-food',storage,1000);
    expect(consumeReadyNutritionShortcut(storage,{authenticated:false,profileReady:false},1100)).toBeNull();
    expect(consumeReadyNutritionShortcut(storage,{authenticated:true,profileReady:false},1100)).toBeNull();
    expect(consumeReadyNutritionShortcut(storage,{authenticated:true,profileReady:true},1100)).toBe('log-food');
    expect(consumeReadyNutritionShortcut(storage,{authenticated:true,profileReady:true},1100)).toBeNull();
  });

  it('rejects unknown and ambiguous actions without changing the URL or pending action',()=>{
    const storage=memoryStorage();
    expect(captureNutritionShortcut('/?nutritionAction=delete-account',storage,1000)).toBeNull();
    expect(captureNutritionShortcut('/?nutritionAction=log-food&nutritionAction=log-weight',storage,1000)).toBeNull();
    expect(storage.values.size).toBe(0);
  });

  it('expires abandoned sign-in actions and discards malformed storage',()=>{
    const storage=memoryStorage();
    captureNutritionShortcut('/?nutritionAction=log-food',storage,1000);
    expect(consumePendingNutritionShortcut(storage,1000+30*60*1000+1)).toBeNull();
    storage.values.set('nourish-pending-shortcut-v1','{bad json');
    expect(consumePendingNutritionShortcut(storage,1000)).toBeNull();
    expect(storage.values.size).toBe(0);
  });

  it('can clear an unconsumed action when the user signs out',()=>{
    const storage=memoryStorage();
    captureNutritionShortcut('/?nutritionAction=log-weight',storage,1000);
    clearPendingNutritionShortcut(storage);
    expect(consumePendingNutritionShortcut(storage,1000)).toBeNull();
  });
});

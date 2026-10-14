import {describe,expect,it} from 'vitest';
import {barcodeFoodPer100,barcodeValue,foodToSearchResult,labelFoodDraft} from './logFood';
import type {FoodDraft} from '../components/FoodEditor';

const serving:FoodDraft={name:'Granola bar',calories:200,protein:4,carbs:30,fat:8,fiber:null,quantity:1,unit:'serving',portionLabel:'bar',portionGrams:40,portionsJson:'[]',source:'Manual',barcode:null,time:null} as unknown as FoodDraft;

describe('log food helpers',()=>{
  it('accepts only 8–14 digit barcodes',()=>{
    expect(barcodeValue(' 5000159407236 ')).toBe('5000159407236');
    expect(barcodeValue('1234')).toBeNull();
    expect(barcodeValue(null)).toBeNull();
  });

  it('stores a barcode food per 100 g from a weighed serving and keeps unknown nutrients unknown',()=>{
    const food=barcodeFoodPer100(serving,'5000159407236');
    expect(food.calories).toBe(500);
    expect(food.protein).toBe(10);
    expect(food.fiber).toBeNull();
    expect(food).toMatchObject({quantity:100,unit:'g',portionLabel:null,portionGrams:null,barcode:'5000159407236'});
    expect(JSON.parse(food.portionsJson)).toEqual([{label:'bar',grams:40}]);
  });

  it('refuses a barcode serving without a weight instead of guessing',()=>{
    expect(()=>barcodeFoodPer100({...serving,portionGrams:null},'5000159407236')).toThrow(/serving label and weight/);
  });

  it('keeps a liquid barcode food per 100 ml and asks for the serving volume',()=>{
    const food=barcodeFoodPer100({...serving,measure:'ml'},'5000159407236');
    expect(food).toMatchObject({measure:'ml',quantity:100,unit:'g'});
    expect(()=>barcodeFoodPer100({...serving,measure:'ml',portionGrams:null},'5000159407236')).toThrow(/serving label and volume in millilitres/);
  });

  it('keeps a saved liquid food measure when it is offered again as a search result',()=>{
    const saved={id:'1',revision:1,deleted:false,name:'Milk',calories:50,protein:3,fat:2,carbs:5,fiber:null,source:'manual',servingGrams:100,favourite:false,barcode:null,ingredientsJson:'[]',portionsJson:'[]',cookedYieldGrams:null};
    expect(foodToSearchResult({...saved,measure:'ml'}).measure).toBe('ml');
    expect(foodToSearchResult(saved).measure).toBeUndefined();
  });

  it('keeps a label reading per serving when the serving weight is unknown',()=>{
    const draft=labelFoodDraft({name:'Soup',calories:120,protein:null,carbs:10,fat:2,fiber:null,quantity:1,unit:'serving',portionLabel:'cup',portionGrams:null} as never,'5000159407236');
    expect(draft).toMatchObject({quantity:1,unit:'serving',calories:120,protein:null,portionGrams:null,portionsJson:'[]'});
  });

  it('scales a weighed label reading to 100 g',()=>{
    const draft=labelFoodDraft({name:'Crackers',calories:150,protein:3,carbs:20,fat:6,fiber:1,quantity:1,unit:'serving',portionLabel:'5 crackers',portionGrams:30} as never,'5000159407236');
    expect(draft).toMatchObject({quantity:100,unit:'g',calories:500,portionLabel:'5 crackers',portionGrams:30});
  });
});

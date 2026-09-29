import {expect,test} from 'vitest';
import {isFatSecretSource} from './foodSources';

test('only the exact fatsecret source line needs its attribution link',()=>{
  expect(isFatSecretSource('Powered by fatsecret')).toBe(true);
  expect(isFatSecretSource('Open Food Facts / ODbL / 12345678')).toBe(false);
  expect(isFatSecretSource('USDA FoodData Central')).toBe(false);
});

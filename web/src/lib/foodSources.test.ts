import {expect,test} from 'vitest';
import {isFatSecretSource} from './foodSources';

test('only the exact fatsecret source line needs its attribution link',()=>{
  expect(isFatSecretSource('Powered by fatsecret')).toBe(true);
  expect(isFatSecretSource('fatsecret')).toBe(true);
  expect(isFatSecretSource('Open Food Facts / ODbL / 12345678')).toBe(false);
  expect(isFatSecretSource('USDA FoodData Central')).toBe(false);
});

import {displaySource} from './foodSources';
test('displaySource drops the AI origin from a saved food',()=>{
    expect(displaySource('Saved food / AI label estimate')).toBe('Saved food');
    expect(displaySource('Open Food Facts / ODbL')).toBe('Open Food Facts / ODbL');
});

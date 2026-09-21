import {describe,it,expect} from 'vitest';
import {foodBasketDraftKey,isFoodBasketDraftKeyLoaded} from './local';

describe('food basket recovery scope',()=>{
  it('binds saved lines to both the selected account and diary date',()=>{
    const key=foodBasketDraftKey('account-a','2026-09-21');
    expect(isFoodBasketDraftKeyLoaded(key,'account-a','2026-09-21')).toBe(true);
    expect(isFoodBasketDraftKeyLoaded(key,'account-b','2026-09-21')).toBe(false);
    expect(isFoodBasketDraftKeyLoaded(key,'account-a','2026-09-22')).toBe(false);
    expect(isFoodBasketDraftKeyLoaded(null,'account-a','2026-09-21')).toBe(false);
  });
});

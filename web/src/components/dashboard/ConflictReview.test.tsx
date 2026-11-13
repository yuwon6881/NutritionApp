import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import type {MutationConflict} from '../../types';
import type {NutritionStore} from '../../useNutritionStore';
import {ConflictReview} from './ConflictReview';

const conflict:MutationConflict={id:'conflict-1',mutation:{id:'conflict-1',kind:'weight',recordId:'weight-1',expectedRevision:1,delete:false,data:{date:'2026-11-13',kg:81}},message:'Conflict',date:'2026-11-13',createdAt:1};
function render(conflicts:MutationConflict[]){
  const store={local:{conflicts},resolveConflicts:vi.fn()} as unknown as NutritionStore;
  return renderToStaticMarkup(createElement(ConflictReview,{store}));
}

it('shows only a light review count on the Dashboard until the user opens the list',()=>{
  const html=render([conflict]);
  expect(html).toContain('Changes to review');
  expect(html).toContain('Review 1 change');
  expect(html).not.toContain('Review sync conflicts');
  expect(render([])).not.toContain('Changes to review');
});
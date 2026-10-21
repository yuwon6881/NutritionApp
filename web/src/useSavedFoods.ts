import { useCallback, useRef, type RefObject } from 'react';
import type { Food, FoodsResponse, LocalData } from './types';
import { apiWithMeta } from './lib/api';
import { readSavedFoods, saveSavedFoods } from './lib/local';
import { isSavedFoodsCacheUsable, mergeSavedFoods } from './lib/savedFoods';
import { singleFlight } from './lib/singleFlight';

type Commit = (change: (data: LocalData) => LocalData) => Promise<void>;

export function useSavedFoods(
  user: string,
  ref: RefObject<LocalData | undefined>,
  alive: RefObject<boolean>,
  foodsEtag: RefObject<string | undefined>,
  commit: Commit
) {
  const requests = useRef(new Map<string, Promise<Food[]>>());

  return useCallback(
    (force = false): Promise<Food[]> =>
      singleFlight(requests.current, force ? 'force' : 'default', async () => {
        const current = ref.current;
        if (!current) return [];
        const expectedRevision = current.state.foodRevision ?? current.state.revision;
        if (!force && current.foodsLoaded) {
          return current.state.foods;
        }
        if (!force) {
          const cached = await readSavedFoods(user);
          if (isSavedFoodsCacheUsable(cached, expectedRevision)) {
            const foods = cached!.foods;
            if (alive.current) {
              await commit(data => ({
                ...data,
                foodsLoaded: true,
                state: { ...data.state, foods: mergeSavedFoods(foods, data.state.foods, cached!.revision) }
              }));
            }
            return ref.current?.state.foods ?? foods;
          }
        }
        const response = await apiWithMeta<FoodsResponse>('/foods', {
          headers: !force && foodsEtag.current ? { 'If-None-Match': foodsEtag.current } : undefined
        });
        if (response.etag) foodsEtag.current = response.etag;
        if (response.notModified) {
          if (alive.current && !ref.current?.foodsLoaded) {
            await commit(data => ({ ...data, foodsLoaded: true }));
          }
          return ref.current?.state.foods ?? [];
        }
        const payload = response.data;
        if (!payload || !alive.current) return ref.current?.state.foods ?? [];
        const foodRevision = payload.foodRevision ?? payload.revision;
        await saveSavedFoods(user, payload.foods, foodRevision);
        if (alive.current) {
          await commit(data => ({
            ...data,
            foodsLoaded: true,
            state: {
              ...data.state,
              foodRevision,
              foods: mergeSavedFoods(payload.foods, data.state.foods, payload.revision)
            }
          }));
        }
        return ref.current?.state.foods ?? payload.foods;
      }),
    [alive, commit, foodsEtag, ref, user]
  );
}

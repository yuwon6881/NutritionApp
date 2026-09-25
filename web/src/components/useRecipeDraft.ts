import {useRef,useState} from 'react';
import type {FoodSearchResult} from '../types';
import {emptyRecipeDraft,emptyRecipeQuantity,type RecipeDraft,type RecipeQuantity} from './RecipeEditor';

const snapshot=(draft:RecipeDraft,selected:FoodSearchResult|undefined,quantity:RecipeQuantity)=>JSON.stringify({draft,selected,quantity});

/** The recipe being built inside the food dialog, with dirty tracking against its starting point. */
export function useRecipeDraft(){
  const [draft,setDraft]=useState<RecipeDraft>(()=>emptyRecipeDraft());
  const [selected,setSelected]=useState<FoodSearchResult>();
  const [quantity,setQuantity]=useState<RecipeQuantity>(()=>emptyRecipeQuantity());
  const initial=useRef(snapshot(emptyRecipeDraft(),undefined,emptyRecipeQuantity()));

  /** Starts over with an empty recipe that counts as unchanged. */
  const reset=()=>{
    setDraft(emptyRecipeDraft());
    setSelected(undefined);
    setQuantity(emptyRecipeQuantity());
    initial.current=snapshot(emptyRecipeDraft(),undefined,emptyRecipeQuantity());
  };
  const clearIngredient=()=>{
    setSelected(undefined);
    setQuantity(emptyRecipeQuantity());
  };
  const pickIngredient=(food:FoodSearchResult)=>{
    setSelected(food);
    setQuantity({grams:food.servingGrams||food.portions?.[0]?.grams||100,selectedPortionLabel:'g',portionMultiplier:1});
  };
  const addIngredient=(food:RecipeDraft['items'][number]['food'],grams:number)=>{
    setDraft(current=>({...current,items:[...current.items,{food,grams}]}));
    clearIngredient();
  };

  return {
    draft,setDraft,selected,quantity,setQuantity,
    dirty:snapshot(draft,selected,quantity)!==initial.current,
    reset,clearIngredient,pickIngredient,addIngredient,
  };
}

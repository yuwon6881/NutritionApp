import type {CSSProperties} from 'react';
import {Plus,Star} from 'lucide-react';
import type {EnergyUnit,Entry,Food} from '../types';
import {isRecipe} from '../lib/logFood';
import {displayEnergy,energyLabel} from '../lib/units';
import {Button} from './ui/Button';
import {Field} from './ui/Field';
import {SegmentedControl} from './ui/SegmentedControl';
import {FoodMacroSummary} from './FoodMacroSummary';
import {RecentFoodCard} from './RecentFoodCard';

export type SavedFilter='all'|'favourites'|'recipes'|'recent';

/** The "Your foods" tab: saved foods, recipes, favourites, and recent diary items. */
export function LogFoodSavedFoods({
  purpose,
  linkBarcode,
  onCancelLink,
  query,
  onQueryChange,
  filter,
  onFilterChange,
  savedFoods,
  recentEntries,
  energyUnit,
  onPickRecent,
  onChoose,
  onToggleFavourite,
  onEdit,
  onCustomFood,
  onNewRecipe,
}:{
  purpose:'log'|'recipe';
  linkBarcode?:string;
  onCancelLink:()=>void;
  query:string;
  onQueryChange:(value:string)=>void;
  filter:SavedFilter;
  onFilterChange:(value:SavedFilter)=>void;
  savedFoods:Food[];
  recentEntries:Entry[];
  energyUnit:EnergyUnit;
  onPickRecent:(entry:Entry)=>void;
  onChoose:(food:Food)=>void;
  onToggleFavourite:(food:Food)=>void;
  onEdit:(food:Food)=>void;
  onCustomFood:()=>void;
  onNewRecipe:()=>void;
}){
  const logging=purpose==='log';
  const linking=Boolean(linkBarcode);
  const favoriteCount=savedFoods.filter(food=>food.favourite).length;
  const recipeCount=savedFoods.filter(isRecipe).length;
  const foods=savedFoods.filter(food=>{
    if((!logging||linking)&&isRecipe(food))return false;
    const matchesQuery=!query.trim()||food.name.toLowerCase().includes(query.toLowerCase().trim());
    if(!matchesQuery)return false;
    if(filter==='favourites')return food.favourite;
    if(filter==='recipes')return isRecipe(food);
    return true;
  }).sort((a,b)=>Number(b.favourite)-Number(a.favourite));
  const recentGrid=(entries:Entry[])=><div className="recent-foods-grid">
    {entries.map((entry,index)=><RecentFoodCard key={entry.id} index={index} entry={entry} energyUnit={energyUnit} onSelect={onPickRecent}/>)}
  </div>;
  const foodRow=(food:Food,index:number)=><div
    className="food-row interactive"
    style={{'--i':Math.min(index,8)} as CSSProperties}
    key={food.id}
  >
    {/* Covers the row so the whole card chooses the food; Favourite and Edit stay separate controls above it. */}
    <Button presentation="plain" className="food-row-choose" aria-labelledby={`saved-${food.id}-name`} aria-describedby={`saved-${food.id}-summary`} onClick={()=>onChoose(food)}/>
    <div className="food-description">
      <div className="saved-food-title-row" id={`saved-${food.id}-name`}>
        <strong>{food.name}</strong>
        {isRecipe(food)&&<span className="food-badge recipe-badge">Recipe</span>}
      </div>
      <div className="saved-food-meta" id={`saved-${food.id}-summary`}>
        <span className="saved-food-energy">{displayEnergy(food.calories,energyUnit)} {energyLabel(energyUnit)} / 100 g</span>
        {(food.protein!=null||food.carbs!=null||food.fat!=null)&&(
          <FoodMacroSummary protein={food.protein} carbs={food.carbs} fat={food.fat} className="food-macro-summary-inline"/>
        )}
      </div>
    </div>
    <div className="food-row-actions">
      <Button
        variant="tertiary"
        className={`food-row-star ${food.favourite?'starred':''}`}
        aria-label={`${food.favourite?'Unfavourite':'Favourite'} ${food.name}`}
        onClick={()=>onToggleFavourite(food)}
      >
        <Star size={18} fill={food.favourite?'currentColor':'none'}/>
      </Button>
      {logging&&<Button
        variant="tertiary"
        aria-label={`Edit ${food.name}`}
        onClick={()=>onEdit(food)}
      >
        Edit
      </Button>}
    </div>
  </div>;
  // The overview is split into labelled groups, favourites first, so a starred food is not buried in one long list.
  const sectioned=logging&&!linking&&filter==='all'&&!query.trim();
  const favourites=sectioned?foods.filter(food=>food.favourite):[];
  const others=sectioned?foods.filter(food=>!food.favourite):[];
  const group=(id:string,title:string,count:number|null,items:Food[])=>items.length>0&&<section className="recent-foods-section" aria-labelledby={id} key={id}>
    <div className="recent-foods-heading"><h4 id={id}>{title}{count!=null&&` (${count})`}</h4></div>
    {items.map(foodRow)}
  </section>;

  return <>
    <div className="saved-foods-header section-heading">
      <div><h3>Your foods</h3><p>{logging?'Saved custom foods, recipes, and recent diary items.':'Choose a saved food for this ingredient.'}</p></div>
      {logging&&<div className="actions saved-foods-actions">
        <Button variant="secondary" onClick={onCustomFood}><Plus size={16}/>Custom food</Button>
        <Button variant="secondary" onClick={onNewRecipe}><Plus size={16}/>New recipe</Button>
      </div>}
    </div>
    {linkBarcode&&<div className="notice barcode-link-notice" role="status">
      <p>Choose one saved non-recipe food to link to barcode {linkBarcode}.</p>
      <Button variant="tertiary" onClick={onCancelLink}>Cancel</Button>
    </div>}
    <div className="saved-foods-search">
      <Field id="log-food-search" name="query" autoComplete="off" autoCorrect="off" spellCheck={false} data-modal-autofocus label="Find your food" placeholder="Filter by food or recipe name…" value={query} onChange={event=>onQueryChange(event.target.value)}/>
    </div>
    <SegmentedControl<SavedFilter>
      layout="wrap"
      className="saved-filter-segments"
      label="Filter your foods"
      value={filter}
      options={[
        {value:'all',label:`All (${savedFoods.length})`},
        {value:'favourites',label:`Favourites (${favoriteCount})`},
        ...(logging&&!linking?[{value:'recipes' as const,label:`Recipes (${recipeCount})`},{value:'recent' as const,label:`Recent (${recentEntries.length})`}]:[]),
      ]}
      onChange={onFilterChange}
    />
    {logging&&!linking&&filter==='recent'
      ?(recentEntries.length>0?recentGrid(recentEntries):<p className="empty recent-empty">No recent diary items yet.</p>)
      :<>
        {logging&&!linking&&filter==='all'&&!query.trim()&&recentEntries.length>0&&<section className="recent-foods-section" aria-labelledby="recent-section-heading">
          <div className="recent-foods-heading"><h4 id="recent-section-heading">Recent items</h4>{recentEntries.length>4&&<Button variant="tertiary" size="sm" onClick={()=>onFilterChange('recent')}>See all {recentEntries.length}</Button>}</div>
          {recentGrid(recentEntries.slice(0,4))}
        </section>}
        {foods.length===0
          ?<p className="empty">
            {query.trim()
              ?`No saved foods matching “${query}”.`
              :filter==='favourites'
              ?'No favourite foods yet. Star foods to find them quickly here.'
              :filter==='recipes'
              ?'No recipes yet. Create one with the New recipe button.'
              :'No saved foods yet.'}
          </p>
          :sectioned
          ?<>
            {group('favourite-foods-heading','Favourites',null,favourites)}
            {group('saved-foods-heading',favourites.length>0?'Other saved foods':'Saved foods',null,others)}
          </>
          :foods.map(foodRow)}
      </>}
  </>;
}

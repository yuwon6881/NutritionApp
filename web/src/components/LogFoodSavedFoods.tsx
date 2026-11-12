import {useMemo,type CSSProperties} from 'react';
import {BookOpen,Clock,Plus,Search,Star,Utensils,UtensilsCrossed} from 'lucide-react';
import type {EnergyUnit,Entry,Food} from '../types';
import {savedFoodKind} from '../lib/savedFoodSearch';
import {displayEnergy,energyLabel} from '../lib/units';
import {measureOf} from '../lib/portions';
import {Button} from './ui/Button';
import {EmptyState} from './ui/EmptyState';
import {Field} from './ui/Field';
import {SegmentedControl} from './ui/SegmentedControl';
import {FoodMacroSummary} from './FoodMacroSummary';
import {RecentFoodCard} from './RecentFoodCard';

export type SavedFilter='all'|'favourites'|'custom'|'recipes'|'recent';

/** The "Your foods" tab: favourites, custom foods, recipes, other saved foods, and recent diary items. */
export function LogFoodSavedFoods({
  purpose,
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

  // The kind parses each food's ingredients; do it once per library rather than per use per render.
  const kinds=useMemo(()=>new Map(savedFoods.map(food=>[food.id,savedFoodKind(food)])),[savedFoods]);
  const recipes={has:(id:string)=>kinds.get(id)==='recipe'};

  const foods=savedFoods.filter(food=>{
    if(!logging&&recipes.has(food.id))return false;
    const matchesQuery=!query.trim()||food.name.toLowerCase().includes(query.toLowerCase().trim());
    if(!matchesQuery)return false;
    if(filter==='favourites')return food.favourite;
    if(filter==='custom')return kinds.get(food.id)==='custom';
    if(filter==='recipes')return recipes.has(food.id);
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
        {recipes.has(food.id)&&<span className="food-badge recipe-badge">Recipe</span>}
        {kinds.get(food.id)==='custom'&&<span className="food-badge recipe-badge">Custom</span>}
      </div>
      <div className="saved-food-meta" id={`saved-${food.id}-summary`}>
        <span className="saved-food-energy">{displayEnergy(food.calories,energyUnit)} {energyLabel(energyUnit)} / 100 {measureOf(food)}</span>
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
  // The overview is split into labelled groups, favourites first, so a starred food is not buried in one long
  // list. A favourite shows only under Favourites; the rest fall under what they are.
  const sectioned=logging&&filter==='all'&&!query.trim();
  const favourites=sectioned?foods.filter(food=>food.favourite):[];
  const rest=sectioned?foods.filter(food=>!food.favourite):[];
  const customFoods=rest.filter(food=>kinds.get(food.id)==='custom');
  const recipeFoods=rest.filter(food=>kinds.get(food.id)==='recipe');
  const others=rest.filter(food=>kinds.get(food.id)==='provider');
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
    <div className="saved-foods-search">
      <Field id="log-food-search" name="query" autoComplete="off" autoCorrect="off" spellCheck={false} data-modal-autofocus label="Find your food" placeholder="Filter by food or recipe name…" value={query} onChange={event=>onQueryChange(event.target.value)}/>
    </div>
    <SegmentedControl<SavedFilter>
      layout="scroll"
      className="saved-filter-segments"
      label="Filter your foods"
      value={filter}
      options={[
        {value:'all',label:'All'},
        {value:'favourites',label:'Favourites'},
        {value:'custom',label:'Custom'},
        ...(logging?[{value:'recipes' as const,label:'Recipes'},{value:'recent' as const,label:'Recent'}]:[]),
      ]}
      onChange={onFilterChange}
    />
    {logging&&filter==='recent'
      ?(recentEntries.length>0?recentGrid(recentEntries):<EmptyState icon={Clock} title="No recent items yet" description="Foods you log show up here so you can add them again in one tap."/>)
      :<>
        {logging&&filter==='all'&&!query.trim()&&recentEntries.length>0&&<section className="recent-foods-section" aria-labelledby="recent-section-heading">
          <div className="recent-foods-heading"><h4 id="recent-section-heading">Recent items</h4>{recentEntries.length>4&&<Button variant="tertiary" size="sm" onClick={()=>onFilterChange('recent')}>See all {recentEntries.length}</Button>}</div>
          {recentGrid(recentEntries.slice(0,4))}
        </section>}
        {foods.length===0
          ?(query.trim()
            ?<EmptyState icon={Search} title="No matching saved foods" description={`Nothing saved matches “${query}”. Try a different word.`}/>
            :filter==='favourites'
            ?<EmptyState icon={Star} title="No favourite foods yet" description="Star foods to find them quickly here."/>
            :filter==='custom'
            ?<EmptyState icon={UtensilsCrossed} title="No custom foods yet" description="Create one with the Custom food button."/>
            :filter==='recipes'
            ?<EmptyState icon={BookOpen} title="No recipes yet" description="Create one with the New recipe button."/>
            :<EmptyState icon={Utensils} title="No saved foods yet" description="Foods you save, create or star will be listed here."/>)
          :sectioned
          ?<>
            {group('favourite-foods-heading','Favourites',null,favourites)}
            {group('custom-foods-heading','Custom foods',null,customFoods)}
            {group('recipe-foods-heading','Recipes',null,recipeFoods)}
            {group('saved-foods-heading','Other saved foods',null,others)}
          </>
          :foods.map(foodRow)}
      </>}
  </>;
}

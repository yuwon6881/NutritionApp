/** Age is derived from the date of birth so it advances with the calendar instead of ageing the profile. */
export function ageOn(birthDate:string|null|undefined,current:string):number|null{
  if(!birthDate||!current)return null;
  const [by,bm,bd]=birthDate.split('-').map(Number);
  const [cy,cm,cd]=current.split('-').map(Number);
  if(!by||!bm||!bd||!cy||!cm||!cd)return null;
  const age=cy-by-(cm<bm||(cm===bm&&cd<bd)?1:0);
  return age>=0?age:null;
}

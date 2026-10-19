/** Source text the API put on fatsecret results before that provider was retired. Saved foods and
 * diary entries logged from them keep it, and its terms require attribution wherever they show. */
export const FATSECRET_SOURCE='Powered by fatsecret';
export const FATSECRET_ATTRIBUTION_URL='https://platform.fatsecret.com';

export const isFatSecretSource=(source:string)=>source===FATSECRET_SOURCE||source==='fatsecret'||source.toLowerCase().includes('fatsecret');

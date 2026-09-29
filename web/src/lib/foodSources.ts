/** Source text the API puts on fatsecret results; its terms require attribution wherever they show. */
export const FATSECRET_SOURCE='Powered by fatsecret';
export const FATSECRET_ATTRIBUTION_URL='https://platform.fatsecret.com';

export const isFatSecretSource=(source:string)=>source===FATSECRET_SOURCE;

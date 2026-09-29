import {FATSECRET_ATTRIBUTION_URL} from '../lib/foodSources';

/** The attribution snippet fatsecret's terms require wherever its food data is displayed. */
export function FatSecretAttribution(){
  return <a href={FATSECRET_ATTRIBUTION_URL}>Powered by fatsecret Platform API</a>;
}

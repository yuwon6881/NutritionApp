import type {InputHTMLAttributes} from 'react';

/**
 * Phones show a digits-only pad unless asked otherwise; fractional steps need
 * the decimal key. An explicit inputMode from the caller still wins.
 */
export function numericInputMode({type,step}:Pick<InputHTMLAttributes<HTMLInputElement>,'type'|'step'>):InputHTMLAttributes<HTMLInputElement>['inputMode']{
  if(type!=='number')return undefined;
  const numericStep=Number(step);
  return step===undefined||(Number.isInteger(numericStep)&&numericStep>0)?'numeric':'decimal';
}

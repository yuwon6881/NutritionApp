/**
 * The text a number field shows when its stored value changes. While the person is typing in the
 * field their text stands: a caller may store a rounded or converted value (whole kcal under a kJ
 * label), and echoing that back mid-keystroke would turn "83" into "84". Otherwise the text follows
 * the value but keeps an equivalent form, so an unfinished "1." stays and a required field the
 * person emptied stays empty for validation rather than showing the 0 a caller stored for it.
 */
export function numberFieldText(previous:string,value:unknown,typing:boolean):string{
  if(typing)return previous;
  const next=value==null?'':String(value);
  if(next==='')return '';
  return Number(previous)===Number(next)?previous:next;
}

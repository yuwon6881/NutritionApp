/**
 * The application mark: one rounded stroke that reads as an N and a falling trend line. The geometry
 * matches scripts/generate-icons.mjs; colours come from semantic tokens so the mark follows the theme.
 */
export function Brand({size=27,className=''}:{size?:number;className?:string}){
  return (
    <svg
      className={`brand-mark ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 192 192"
      role="img"
      aria-label="Nutrition"
      focusable="false"
    >
      <rect width="192" height="192" rx="43" className="brand-mark-plate"/>
      <path
        d="M62 130V62C100 62 92 130 130 130V62"
        className="brand-mark-letter"
        fill="none"
        strokeWidth="24"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

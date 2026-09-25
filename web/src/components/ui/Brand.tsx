/** The application mark, drawn from semantic tokens so it follows the active theme. */
export function Brand({size=27,className=''}:{size?:number;className?:string}){
  return (
    <svg
      className={`brand-mark ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 192 192"
      role="img"
      aria-label="Nutrition App"
      focusable="false"
    >
      <rect width="192" height="192" rx="44" className="brand-mark-plate"/>
      <path d="M50 137V55h20l52 61V55h20v82h-20L70 76v61z" className="brand-mark-letter"/>
    </svg>
  );
}

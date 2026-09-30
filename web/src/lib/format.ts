export const today=(zone='Asia/Kuala_Lumpur')=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const number=(v:number|null|undefined,digits=0)=>v==null?'—':v.toLocaleString('en-MY',{maximumFractionDigits:digits});
export function trend(points:{date:string;kg:number}[]){let previous:{date:string;kg:number}|undefined;return [...points].sort((a,b)=>a.date.localeCompare(b.date)).map(p=>{const elapsed=previous?(Date.parse(p.date)-Date.parse(previous.date))/86400000:0;const next={date:p.date,kg:previous?previous.kg+(1-Math.pow(.5,elapsed/7))*(p.kg-previous.kg):p.kg};previous=next;return next;});}

/** A calendar date (YYYY-MM-DD) as "Monday, Sep 28". Dates carry no time, so format them in UTC. */
export const longDate=(date:string)=>new Intl.DateTimeFormat('en',{weekday:'long',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(`${date}T00:00:00Z`));

const dateFormat=(options:Intl.DateTimeFormatOptions)=>{
  const formatter=new Intl.DateTimeFormat('en',{...options,timeZone:'UTC'});
  return (date:string)=>formatter.format(new Date(`${date}T00:00:00Z`));
};
/** "Sep 28": chart axes and compact date ranges. */
export const shortDate=dateFormat({month:'short',day:'numeric'});
/** "Mon, Sep 28, 2026": a chart readout, where the year may be outside the visible range. */
export const readoutDate=dateFormat({weekday:'short',month:'short',day:'numeric',year:'numeric'});
/** "Mon": the weekday above a daily bar. */
export const weekdayShort=dateFormat({weekday:'short'});
/** "Sep 2026": a monthly bucket. */
export const monthYear=dateFormat({month:'short',year:'numeric'});
/** "Sep": the month on a date badge. */
export const monthShort=dateFormat({month:'short'});

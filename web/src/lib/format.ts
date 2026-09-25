export const today=(zone='Asia/Kuala_Lumpur')=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const number=(v:number|null|undefined,digits=0)=>v==null?'—':v.toLocaleString('en-MY',{maximumFractionDigits:digits});
export function trend(points:{date:string;kg:number}[]){let previous:{date:string;kg:number}|undefined;return [...points].sort((a,b)=>a.date.localeCompare(b.date)).map(p=>{const elapsed=previous?(Date.parse(p.date)-Date.parse(previous.date))/86400000:0;const next={date:p.date,kg:previous?previous.kg+(1-Math.pow(.5,elapsed/7))*(p.kg-previous.kg):p.kg};previous=next;return next;});}

/** A calendar date (YYYY-MM-DD) as "Monday, Sep 28". Dates carry no time, so format them in UTC. */
export const longDate=(date:string)=>new Intl.DateTimeFormat('en',{weekday:'long',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(`${date}T00:00:00Z`));

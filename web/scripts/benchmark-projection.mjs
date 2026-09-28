import ts from 'typescript';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';

const source = readFileSync(new URL('../src/lib/projection.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {project} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const rows = [];
for (const days of [7,365,3650]) {
  const date = index => new Date(Date.UTC(2026,8,28-index)).toISOString().slice(0,10);
  const state = {
    id:'benchmark',displayName:'Benchmark',revision:1,profileRevision:0,profile:null,
    start:date(days-1),end:date(0),entries:[],foods:[],weights:[],days:[],plans:[]
  };
  for (let i=0;i<days;i++) {
    state.weights.push({id:`w${i}`,revision:1,deleted:false,date:date(i),kg:80+i%5*.1});
    state.days.push({id:`d${i}`,revision:1,deleted:false,date:date(i),status:'complete'});
    // Keep meal detail bounded just like the production bootstrap.
    if(i<90)for(let j=0;j<8;j++)state.entries.push({id:`e${i}:${j}`,revision:1,deleted:false,date:date(i),name:'Food',calories:100,protein:null,carbs:null,fat:null,fiber:null,source:'manual',quantity:100,unit:'g'});
  }
  state.foods=Array.from({length:1000},(_,i)=>({id:`f${i}`,revision:1,deleted:false,name:`Food ${i}`,calories:100,protein:null,carbs:null,fat:null,fiber:null,source:'manual',servingGrams:100,favourite:false,ingredientsJson:'',portionsJson:'[]',cookedYieldGrams:null}));
  for(const count of [0,1,120]) {
    const queue=Array.from({length:count},(_,i)=>({id:`m${i}`,kind:'weight',recordId:`w${i}`,expectedRevision:1,delete:false,data:{date:date(i),kg:81}}));
    const samples=[];
    for(let i=0;i<25;i++) {
      const started=performance.now();
      project(state,queue);
      samples.push(performance.now()-started);
    }
    const warm=samples.slice(5).sort((a,b)=>a-b);
    rows.push({days,queue:count,coldMs:samples.slice(0,5),warmP95Ms:warm[Math.ceil(warm.length*.95)-1]});
  }
}
mkdirSync('artifacts/performance',{recursive:true});
const label=process.argv[2]??'current';
if(!/^[a-z0-9-]+$/i.test(label))throw new Error('Use a simple report label.');
writeFileSync(`artifacts/performance/projection-${label}.json`,JSON.stringify({node:process.version,rows},null,2));
console.table(rows.map(({days,queue,warmP95Ms})=>({days,queue,p95Ms:Math.round(warmP95Ms*1000)/1000})));

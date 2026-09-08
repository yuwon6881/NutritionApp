// Evaluate user-supplied, consented weighed meals or transcribed labels against saved AI drafts.
// No network calls or images are uploaded by this reporting tool.
import {readFile,writeFile} from 'node:fs/promises';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw new Error('Usage: node tools/ai-evaluation.mjs fixtures.json report.json');
const fixtures=JSON.parse(await readFile(input,'utf8'));
if(!Array.isArray(fixtures)||fixtures.length===0)throw new Error('Supply at least one measured reference fixture.');
const rows=fixtures.map(f=>{
  if(!f.id||!['weighed-meal','nutrition-label'].includes(f.referenceType)||!Number.isFinite(f.referenceCalories)||f.referenceCalories<=0||!Array.isArray(f.aiDraft?.foods))throw new Error('Every fixture needs id, referenceType, positive referenceCalories and aiDraft.foods.');
  const estimate=f.aiDraft.foods.reduce((sum,food)=>{if(!Number.isFinite(food.calories)||food.calories<0)throw new Error('Invalid AI calories.');return sum+food.calories;},0);
  return {id:f.id,referenceType:f.referenceType,referenceCalories:f.referenceCalories,estimatedCalories:estimate,absoluteError:Math.abs(estimate-f.referenceCalories),absolutePercentError:100*Math.abs(estimate-f.referenceCalories)/f.referenceCalories};
});
const report={count:rows.length,meanAbsoluteCalorieError:rows.reduce((s,r)=>s+r.absoluteError,0)/rows.length,meanAbsolutePercentError:rows.reduce((s,r)=>s+r.absolutePercentError,0)/rows.length,rows,limitation:'Accuracy applies only to these fixtures. Photo portion estimates are not measurements or a validated clinical method.'};
await writeFile(output,JSON.stringify(report,null,2));console.log(`Wrote ${rows.length} measured fixture results.`);

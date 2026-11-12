import {$,table} from './test-view.mjs';
import {fmt,METRICS} from './test-model.mjs';

export function renderAlignedComparison(vm,onCompare,onPick) {
  if(!vm.test)return;
  const host=document.createElement('section');host.id='route-aligned-comparison';host.className='panel';
  host.innerHTML='<h3>Compare the same route</h3><p class="comparison-note">Align the baseline A and current B by 20 m route bins. Imported captures require route associations in the same direction and at least 80% common coverage. Their differences are observational.</p>';
  const compare=document.createElement('button');compare.id='compare-aligned';compare.textContent='Compare aligned route';compare.disabled=!vm.baseline;
  compare.onclick=onCompare;host.append(compare);
  const result=vm.routeComparison;
  if(result){
    const note=document.createElement('p');note.className='comparison-note';note.textContent=`${result.mode} · ${fmt(result.common_coverage_pct)}% common route coverage · ${result.bin_m} m bins · B − A · frozen profile ${result.profile.name}`;host.append(note);
    const summary=document.createElement('div');summary.innerHTML=table(['A baseline','B current','Median B − A'],[[result.a_id,result.b_id,`${fmt(result.median_delta??result.median_delta_db)} ${result.delta_unit||(METRICS[result.metric].unit==='dBm'?'dB':METRICS[result.metric].unit)}`]]);host.append(summary);
    const canvas=document.createElement('canvas');canvas.className='comparison-map';canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Route comparison map. Green points improve the selected metric; orange points regress.');host.append(canvas);
    const legend=document.createElement('p');legend.className='comparison-note';legend.textContent='Green: improvement · Orange: regression · Gray: unchanged. Select a point to inspect its route position in Replay.';host.append(legend);
    const width=700,height=210;canvas.width=width*2;canvas.height=height*2;const ctx=canvas.getContext('2d');ctx.scale(2,2);
    const pairs=result.pairs,points=pairs.map(p=>[p.longitude*Math.cos(p.latitude*Math.PI/180),p.latitude]);
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),minX=xs.reduce((a,b)=>Math.min(a,b),Infinity),minY=ys.reduce((a,b)=>Math.min(a,b),Infinity),spanX=xs.reduce((a,b)=>Math.max(a,b),-Infinity)-minX||.001,spanY=ys.reduce((a,b)=>Math.max(a,b),-Infinity)-minY||.001;
    const scale=Math.min((width-48)/spanX,(height-48)/spanY),project=p=>[24+(p[0]-minX)*scale,height-24-(p[1]-minY)*scale];
    ctx.strokeStyle='#b5c5b0';ctx.lineWidth=3;ctx.beginPath();points.forEach((p,i)=>{const[x,y]=project(p);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();
    pairs.forEach((p,i)=>{const[x,y]=project(points[i]),improved=METRICS[result.metric].bad==='above'?p.delta<0:p.delta>0;ctx.fillStyle=Math.abs(p.delta)<1e-6?'#758274':improved?'#135a43':'#b55d24';ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill();});
    const label=document.createElement('label');label.textContent='Inspect route position';
    const position=document.createElement('select');position.setAttribute('aria-label','Inspect route position');
    position.add(new Option('Select a paired route bin',''));
    pairs.forEach((p,i)=>position.add(new Option(`${fmt(p.chainage_m,0)} m · ${p.rat} · B − A ${fmt(p.delta)}`,String(i))));
    position.onchange=()=>{if(position.value!=='')onPick(pairs[Number(position.value)].chainage_m);};label.append(position);host.append(label);
    canvas.onclick=event=>{const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width*width,y=(event.clientY-rect.top)/rect.height*height;let index=0,closest=Infinity;points.forEach((p,i)=>{const[a,b]=project(p),d=Math.hypot(x-a,y-b);if(d<closest){closest=d;index=i;}});onPick(pairs[index].chainage_m);};
  }
  $('analytics').append(host);
}

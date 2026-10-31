import { chromium } from 'playwright';
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// A production rendering check, not hand-input acceptance. Seeded saves and
// synthetic menu events only select views; no simulation state is changed.
const origin=process.env.TIDEKEEPER_PREVIEW_ORIGIN??'https://127.0.0.1:8182';
const path=process.argv.includes('--pages')?'/tidekeeper/':'/';
const injection=await build({stdin:{contents:"import { XRDevice, metaQuest3 } from 'iwer'; window.__testDevice=new XRDevice(metaQuest3); window.__testDevice.stereoEnabled=false; window.__testDevice.primaryInputMode='hand'; window.__testDevice.installRuntime({forceInstall:true});",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:800,height:800}});
try {
  await context.addInitScript({content:injection.outputFiles[0].text});
  await context.addInitScript(()=>{
    window.__observedThree=[]; window.__THREE_DEVTOOLS__=new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener('observe',event=>window.__observedThree.push(event.detail));
    const date=new Date(), today=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    const missions=Object.fromEntries(Array.from({length:8},(_,i)=>[`m0${i+1}`,{stars:3,pieces:8,tick:9}]));
    localStorage.setItem('tidekeeper.progress.v1',JSON.stringify({version:1,missions,daily:{lastSolved:today,streak:3,best:{[today]:{pieces:4,tick:8}}},settings:{reach:'near',sound:false}}));
  });
  const page=await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+path); await page.getByRole('button',{name:'Play',exact:true}).click();
  await page.waitForFunction(()=>!!window.__testDevice.activeSession);
  await page.waitForTimeout(900);
  mkdirSync('output/xr',{recursive:true});
  await page.screenshot({path:'output/xr/archipelago-progress.png'});
  const menu=async name=>{
    await page.evaluate(name=>{
      let button;
      for(const scene of window.__observedThree.filter(o=>o.isScene)) scene.traverse(o=>{if(o.name===name)button=o});
      if(!button)throw Error(`Missing menu control ${name}`);
      button.dispatchEvent({type:'pointerdown',pointerId:-1,stopPropagation(){}});
      button.dispatchEvent({type:'pointerup',pointerId:-1,stopPropagation(){}});
    },name);
    await page.waitForTimeout(700);
  };
  await menu('Mission9');
  const renderer=await page.evaluate(()=>{
    const r=window.__observedThree.find(o=>o.info?.render&&o.xr);
    return {render:{...r.info.render},memory:{...r.info.memory},sessionActive:r.xr.isPresenting};
  });
  if(!renderer.sessionActive||renderer.render.calls>100||errors.length)throw Error(JSON.stringify({renderer,errors}));
  await page.screenshot({path:'output/xr/m09-production-editing.png'});
  await menu('Map'); await menu('Daily');
  await page.screenshot({path:'output/xr/daily-tide-streak.png'});
  const report={fixture:'Seeded 8 delivered villages and a 3-day daily streak; synthetic menu selection only',m09:renderer,errors};
  writeFileSync('output/xr/production-gallery.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally {await browser.close()}

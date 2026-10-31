import { chromium } from 'playwright';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';

// The IWSDK Vite plugin supplies HTTPS to vite preview too. Port 8181 avoids
// Windows' reserved 4094-4193 range, which includes Vite's usual preview port.
const origin = 'https://127.0.0.1:8181';
const injection = await build({stdin:{contents:"import { XRDevice, metaQuest3 } from 'iwer'; window.__testDevice = new XRDevice(metaQuest3); window.__testDevice.stereoEnabled = false; window.__testDevice.primaryInputMode = 'hand'; window.__testDevice.installRuntime({forceInstall:true}); const request = navigator.xr.requestSession.bind(navigator.xr); navigator.xr.requestSession = (mode, options) => { window.__requestedMode = mode; return request(mode, options); };",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
let browser;
const lines=[];
try {
  browser=await chromium.launch({headless:true});
  for (const mode of ['ar','vr']) {
    const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:800,height:800}});
    await context.addInitScript({content:injection.outputFiles[0].text});
    const page=await context.newPage(), errors=[], outside=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if (url.protocol.startsWith('http') && url.origin!==origin) {outside.push(url.href);return route.abort()}
      return route.continue();
    });
    await page.goto(origin);
    try { await page.getByRole('button',{name:'Play',exact:true}).waitFor({timeout:8000}); }
    catch (error) { throw new Error(JSON.stringify({message:error.message,errors,outside,body:await page.locator('body').innerText()})); }
    await page.getByRole('checkbox').setChecked(mode==='ar');
    await page.getByRole('button',{name:'Play',exact:true}).click();
    await page.waitForFunction(()=>!!window.__testDevice.activeSession);
    await page.waitForTimeout(700);
    const measured=await page.evaluate(()=>({mode:window.__requestedMode,debugPresent:'__tidekeeper' in window,canvas:!!window.__testDevice.appCanvas,handMode:window.__testDevice.primaryInputMode}));
    if (measured.mode!==`immersive-${mode}` || measured.debugPresent || !measured.canvas || errors.length || outside.length) throw new Error(JSON.stringify({measured,errors,outside}));
    mkdirSync('output/xr',{recursive:true});
    await page.screenshot({path:`output/xr/production-${mode}.png`});
    const line=`PASS production ${mode.toUpperCase()} entry; hands; no dev debug; no external requests`;
    lines.push(line);console.log(line);
    await context.close();
  }
} catch(error) {lines.push(`FAIL production: ${error.message}`);console.error(lines.at(-1));process.exitCode=1}
finally {await browser?.close();writeFileSync('output/xr/production.txt',lines.join('\n')+'\n')}

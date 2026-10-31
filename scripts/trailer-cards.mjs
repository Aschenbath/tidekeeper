import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

// All local: system fonts, CSS decoration, no downloaded art or audio.
const cards = [
  ['card-title', 'TIDEKEEPER', 'A little sea.<br>A plan you can trust.', 'A seated, hands-only mixed-reality puzzle', 'META VR START · IWSDK 1.1'],
  ['card-place', '01 / PLACE', 'Your first letter<br>starts with a pinch.', 'Carry a channel piece from the tray onto the board.<br>Or poke a piece, then poke a square.', 'FIRST FIVE MINUTES'],
  ['card-preview', '02 / PREVIEW', 'Turn the tide.<br>See what happens.', 'Scrub the ring to see the boats, low water and collisions.<br>Each problem tells you why.', 'FIRST FIVE MINUTES'],
  ['card-launch', '03 / LAUNCH', 'The same plan.<br>The same result.', 'The preview and the run use the same simulation.<br>A dry sandbar in the preview is a dry sandbar at launch.', 'FIRST FIVE MINUTES'],
  ['card-campaign', 'THE ARCHIPELAGO', 'Nine villages.<br>One lighthouse.', 'Learn shapes, tides, locks and crossings.<br>Every delivery lights another village.', 'CAMPAIGN'],
  ['card-daily', 'DAILY TIDE', 'A new tide.<br>A reason to return.', 'A date-seeded puzzle, checked for a working solution.<br>Keep your streak and improve your best.', 'DAILY PUZZLE'],
  ['card-accessibility', 'MADE FOR YOUR HANDS', 'A calmer way<br>to play.', 'One hand · Either hand · Poke mode<br>Sail shapes, not colour · Sound optional', 'ACCESSIBILITY'],
  ['card-closing', 'TIDEKEEPER', 'Plan the tide.<br>Light the islands.', 'Recorded in the IWSDK emulator; not yet tested on a physical Quest.<br>Built with AI assistance (OpenAI Codex, Anthropic Claude Code).', 'EMULATOR CAPTURE · NO PHYSICAL HEADSET TEST YET'],
];
function html([, eyebrow, title, body, footer]) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Tidekeeper video card</title><style>
*{box-sizing:border-box}body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#f3e8ce;color:#26484e;font-family:Arial,Helvetica,sans-serif}
main{height:100%;padding:100px 115px;position:relative}.eyebrow{font-size:29px;letter-spacing:6px;font-weight:700;margin-bottom:48px}
h1{font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:105px;line-height:1.08;letter-spacing:-3px;margin:0 0 48px;position:relative;z-index:1}
p{font-size:32px;line-height:1.6;margin:0;max-width:1510px;position:relative;z-index:1}.footer{position:absolute;bottom:72px;left:115px;font-size:22px;letter-spacing:4px}
.sea{position:absolute;right:-240px;top:80px;width:840px;height:840px;border:2px solid #267e8030;border-radius:50%;box-shadow:0 0 0 70px #267e8009,0 0 0 140px #267e8009}
.boat{position:absolute;right:180px;top:385px;width:165px;height:72px;background:#c7863f;border-radius:8px 8px 75px 75px;transform:rotate(-12deg)}.boat:before{content:'';position:absolute;bottom:88px;left:75px;border-left:60px solid #267e80;border-top:100px solid transparent}.boat:after{content:'';position:absolute;bottom:72px;left:68px;width:5px;height:130px;background:#26484e}
.line{position:absolute;left:115px;bottom:130px;width:110px;height:6px;background:#267e80}
</style><main><div class="sea"></div><div class="boat"></div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${body}</p><div class="line"></div><div class="footer">${footer}</div></main></html>`;
}
export async function renderCards(browser, output) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage(), files = [];
  try {
    for (const card of cards) {
      const file = `${card[0]}.png`;
      await page.setContent(html(card)); await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: resolve(output, file) }); files.push({ file });
    }
    writeFileSync(resolve(output, 'cards.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>Tidekeeper video cards</title><style>body{margin:24px;background:#26484e;color:#f3e8ce;font:18px Arial}figure{margin:0 0 32px}img{display:block;width:min(100%,960px)}figcaption{margin-top:8px}</style>${cards.map(([id]) => `<figure><img src="${id}.png" alt="${id}"><figcaption>${id}</figcaption></figure>`).join('\n')}</html>`);
    return files;
  } finally { await context.close(); }
}

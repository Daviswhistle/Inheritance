// Native HTML/CSS compositions using actual UI captures. World portal constraints:
// content card 345:240, showcases 1:1 (1080 px), meta tag 2:1 (1200x600).
// Source: worldcoin/developer-portal, PortalV3 Configuration/AppStore image fields.
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launch } from './verify/drv.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const raw = process.env.STORE_RAW_DIR || '/tmp/wld-verify/shots';
const destination = path.join(root, 'app/public/store');
mkdirSync(destination, { recursive: true });
const image = name => 'data:image/png;base64,' + readFileSync(path.join(raw, name + '.png')).toString('base64');
const icon = readFileSync(path.join(root, 'app/public/icon.svg'), 'utf8');
const esc = value => value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const shots = {
  countdown: image(process.env.YIELD_STORE_IMAGES === '1' ? 'yield-store-countdown' : 'store-2-countdown'),
  create: image(process.env.YIELD_STORE_IMAGES === '1' ? 'yield-store-create' : 'store-1-create'),
  welcome: image(process.env.YIELD_STORE_IMAGES === '1' ? 'yield-store-welcome' : 'store-0-welcome'),
  ...(process.env.YIELD_STORE_IMAGES === '1' ? { yield: image('yield-store-position') } : {}),
};
const layouts = [
  { name:'content_card', width:1035, height:720, title:'A little care.\nA lasting gift.', text:'A WLD plan for someone you choose.', shot:'countdown', detail:'Choose an heir. Set a check-in timer.', screenHeight:590, screenRight:42, top:150, titleSize:61 },
  { name:'hero', width:1035, height:720, title:'For someone\nyou love.', text:'Your WLD. Your choice.', shot:'welcome', detail:'A personal inheritance vault.', screenHeight:590, screenRight:42, top:155, titleSize:64 },
  { name:'showcase_1', width:1080, height:1080, title:'Check in.\nCarry on.', text:'Reset your timer to stay in control.', shot:'countdown', detail:'Basic vault: no platform fee. You hold your keys.', screenHeight:866, screenRight:42, top:325, titleSize:78 },
  { name:'showcase_2', width:1080, height:1080, title:'Choose\nyour person.', text:'A contact, a username or a wallet address.', shot:'create', detail:'Set a renewal period of 1–365 days.', screenHeight:866, screenRight:42, top:325, titleSize:75 },
  { name:'meta_tag', width:1200, height:600, title:'A little care.\nA lasting gift.', text:'A WLD vault for someone you love.', shot:'countdown', detail:'Your own vault. Your choice.', screenHeight:514, screenRight:83, top:155, titleSize:68 },
];
if (process.env.YIELD_STORE_IMAGES === '1') layouts.push({ name:'showcase_3', width:1080, height:1080, title:'An option\nfor yield.', text:'Choose Morpho lending for your WLD.', shot:'yield', detail:'10% of positive net gains on exit. Principal can lose value. Cash depends on liquidity.', screenHeight:866, screenRight:42, top:295, titleSize:75 });
for (const layout of layouts) {
  const page = await launch({url:'about:blank'});
  try {
    const {name,width,height,title,text,shot,detail,screenHeight,screenRight,top,titleSize} = layout;
    const phoneWidth = Math.round(screenHeight * 780 / 1688);
    await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:#f7f8f2;color:#203b32;font-family:Arial,Helvetica,sans-serif}
      .orb{position:absolute;right:-130px;top:-60px;width:${height+200}px;height:${height+200}px;border-radius:50%;background:#e6eddd;border:1px solid #dbe4d3}
      .brand{position:absolute;left:60px;top:50px;display:flex;align-items:center;gap:17px;font-size:29px;font-weight:600;letter-spacing:-.8px}
      .brand svg{width:53px;height:53px;border-radius:17px}
      .copy{position:absolute;left:60px;top:${top}px;width:${width-phoneWidth-screenRight-120}px}
      .eyebrow{font-size:16px;letter-spacing:2px;color:#63806d;text-transform:uppercase;font-weight:600}
      h1{font-size:${titleSize}px;line-height:1.05;letter-spacing:-3px;font-weight:500;margin:25px 0 27px;white-space:pre-line}
      .text{font-size:26px;line-height:1.4;color:#637569;max-width:470px;margin:0 0 36px}
      .detail{font-size:20px;line-height:1.6;color:#235743;max-width:420px}
      .screen{position:absolute;right:${screenRight}px;top:${Math.round((height-screenHeight)/2)}px;width:${phoneWidth}px;height:${screenHeight}px;overflow:hidden;border:5px solid #fff;border-radius:31px;box-shadow:0 18px 50px #1e493122;background:#f7f8f2}
      .screen img{width:100%;height:100%;object-fit:cover;display:block}
      .footer{position:absolute;left:60px;bottom:39px;font-size:16px;color:#768275;line-height:1.55;max-width:${width-phoneWidth-screenRight-120}px}
    </style></head><body><div class="orb"></div><div class="brand">${icon}<span>Inheritance</span></div><div class="copy"><div class="eyebrow">A simple plan</div><h1>${esc(title)}</h1><p class="text">${esc(text)}</p><div class="detail">${esc(detail)}</div></div><div class="screen"><img alt="Actual example vault screen" src="${shots[shot]}"></div><div class="footer">inheritance.pages.dev<br>Example screens. Balances are illustrative.</div></body></html>`;
    const {frameTree}=await page.send('Page.getFrameTree');
    await page.send('Page.setDocumentContent',{frameId:frameTree.frame.id,html});
    await page.ev('await Promise.all([...document.images].map(image=>image.decode())); return true;');
    const screenshot=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    const bytes=Buffer.from(screenshot.data,'base64');
    if(bytes.length>500*1024)throw new Error(name+' exceeds the portal size limit');
    writeFileSync(path.join(destination,name+'.png'),bytes);
    console.log(name+'.png',width+'x'+height,bytes.length,'bytes');
  } finally { await page.close(); }
}
const logo=spawnSync('node',[path.join(root,'scripts/rasterize-icon.mjs')],{stdio:'inherit'});
if(logo.status!==0)process.exit(logo.status||1);
for(const name of ['logo',...layouts.map(layout=>layout.name)]){
  if(statSync(path.join(destination,name+'.png')).size>500*1024)throw new Error(name+' exceeds 500KB');
}

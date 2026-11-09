// Native HTML/CSS compositions using actual UI captures. World portal constraints:
// content card 345:240, showcases 1:1 (1080 px), meta tag 2:1 (1200x600).
// Source: worldcoin/developer-portal, PortalV3 Configuration/AppStore image fields.
// STORE_LOCALE=ko requires a separate STORE_DEST_DIR; English remains the default.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, statSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launch } from './verify/drv.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const raw = process.env.STORE_RAW_DIR || '/tmp/inheritance-store';
const locale = process.env.STORE_LOCALE || 'en';
if (!['en', 'ko'].includes(locale)) throw new Error('STORE_LOCALE must be en or ko');
if (locale === 'ko' && !process.env.STORE_DEST_DIR) throw new Error('Set STORE_DEST_DIR for Korean images to preserve English assets');
const defaultDestination = path.join(root, 'app/public/store');
const destination = path.resolve(process.env.STORE_DEST_DIR || defaultDestination);
if (locale === 'ko' && destination === defaultDestination) throw new Error('Korean images must use a destination separate from app/public/store');
mkdirSync(destination, { recursive: true });
const image = name => 'data:image/png;base64,' + readFileSync(path.join(raw, name + '.png')).toString('base64');
const icon = readFileSync(path.join(root, 'app/public/icon.svg'), 'utf8');
const esc = value => value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const usdcStore = process.env.USDC_STORE_IMAGES === '1';
const unifiedStore = process.env.UNIFIED_STORE_IMAGES === '1' || (!usdcStore && !process.env.YIELD_STORE_IMAGES);
if (locale === 'ko' && !unifiedStore) throw new Error('Korean compositions require current unified app captures');
const only = process.env.STORE_ONLY?.split(',').filter(Boolean) || (locale === 'ko' ? ['showcase_1', 'showcase_2', 'showcase_3', 'meta_tag'] : undefined);
const compositionEvidence = { locale, raw, destination, images: [] };
const shots = unifiedStore ? { countdown: image('unified-store-overview'), create: image('unified-store-create'),
  welcome: image('unified-store-welcome'), income: image('unified-store-income') } : usdcStore ? { yield: image('usdc-store-position') } : {
  countdown: image(process.env.YIELD_STORE_IMAGES === '1' ? 'yield-store-countdown' : 'store-2-countdown'),
  create: image(process.env.YIELD_STORE_IMAGES === '1' ? 'yield-store-create' : 'store-1-create'),
  welcome: image(process.env.YIELD_STORE_IMAGES === '1' ? 'yield-store-welcome' : 'store-0-welcome'),
  ...(process.env.YIELD_STORE_IMAGES === '1' ? { yield: image('yield-store-position') } : {}),
};
const layouts = usdcStore ? [] : [
  { name:'content_card', width:1035, height:720, title:'A little care.\nA lasting gift.', text:unifiedStore ? 'A WLD and USDC plan for someone you choose.' : 'A WLD plan for someone you choose.', shot:'countdown', detail:'Choose an heir. Set a check-in timer.', screenHeight:590, screenRight:42, top:150, titleSize:61 },
  { name:'hero', width:1035, height:720, title:'For someone\nyou trust.', text:unifiedStore ? 'Set aside WLD and USDC for your chosen heir.' : 'Set aside WLD for your chosen heir.', shot:'welcome', detail:'Keep control with regular check-ins.', screenHeight:590, screenRight:42, top:155, titleSize:64 },
  { name:'showcase_1', width:1080, height:1080, title:'Check in.\nCarry on.', text:'Check in to keep your plan active.', shot:'countdown', detail:unifiedStore ? 'WLD and USDC together. You hold your keys.' : 'Basic vault: no platform fee. You hold your keys.', screenHeight:866, screenRight:42, top:325, titleSize:78 },
  { name:'showcase_2', width:1080, height:1080, title:unifiedStore ? 'Choose your\namounts.' : 'Choose\nyour person.', text:unifiedStore ? 'WLD and USDC. One heir and check-in.' : 'A contact, a username or a wallet address.', shot:'create', detail:'Set a renewal period of 1–365 days.', screenHeight:866, screenRight:42, top:325, titleSize:75 },
  { name:'meta_tag', width:1200, height:600, title:'Your assets.\nYour person.', text:unifiedStore ? 'WLD and USDC for your recipient.' : 'WLD for your recipient.', shot:'countdown', detail:'Choose an heir. Check in regularly.', screenHeight:514, screenRight:83, top:135, titleSize:68 },
];
if (unifiedStore) layouts.push({ name:'showcase_3', width:1080, height:1080, title:'Your income.\nYour choice.', text:'Collect available income.', shot:'income', detail:'Service fee: 10% of net realized gains. Strategy fees also apply. Invested assets can lose value. Cash depends on liquidity.', screenHeight:866, screenRight:42, top:295, titleSize:75 });
else if (usdcStore) layouts.push({ name:'showcase_3', width:1080, height:1080, title:'Choose WLD.\nOr USDC.', text:'Separate vaults. One simple plan.', shot:'yield', detail:'USDC earns with Morpho. 10% gain fee. Principal can lose value. Cash depends on liquidity.', screenHeight:866, screenRight:42, top:275, titleSize:75 });
else if (process.env.YIELD_STORE_IMAGES === '1') layouts.push({ name:'showcase_3', width:1080, height:1080, title:'An option\nfor yield.', text:'Choose Morpho lending for your WLD.', shot:'yield', detail:'10% of positive net gains on exit. Principal can lose value. Cash depends on liquidity.', screenHeight:866, screenRight:42, top:295, titleSize:75 });
const koreanCopy = {
  showcase_1: { title: '내가 정한 기한,\n직접 연장하세요.', text: '연장 거래가 완료되면 새 기한이 시작됩니다.', detail: 'WLD와 USDC의 기한을 함께 연장할 수 있습니다.', titleSize: 60 },
  showcase_2: { title: '금액과 수령인을\n직접 정하세요.', text: 'WLD·USDC 중 원하는 자산만 선택하세요.', detail: '기한 연장 주기는 1~365일입니다.', titleSize: 60 },
  showcase_3: { title: '수익을 확인하고,\n직접 인출하세요.', text: '남은 자산은 계속 운용됩니다.', detail: '서비스 수수료는 실현 순수익의 10%입니다. 운용 수수료는 별도입니다. 원금 손실이 발생할 수 있고, 출금은 유동성에 따라 달라집니다.', titleSize: 60 },
  meta_tag: { title: '내 자산을\n내가 정한 사람에게.', text: '믿는 사람에게 전할 WLD·USDC를 준비하세요.', detail: '수령인을 정하고 기한을 연장하세요.', titleSize: 64 },
};
if (only?.some(name => name !== 'logo' && !layouts.some(layout => layout.name === name))) throw new Error('Unknown STORE_ONLY image');
const selectedLayouts = layouts.filter(layout => !only || only.includes(layout.name)).map(layout => {
  if (locale !== 'ko') return layout;
  if (!koreanCopy[layout.name]) throw new Error('No Korean composition for ' + layout.name);
  return { ...layout, ...koreanCopy[layout.name] };
});
for (const layout of selectedLayouts) {
  const page = await launch({url:'about:blank'});
  try {
    const {name,width,height,title,text,shot,detail,screenHeight,screenRight,top,titleSize} = layout;
    const phoneWidth = Math.round(screenHeight * 780 / 1688);
    await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    // World App supplies the card's name, icon and description itself. Keep
    // the illustration above its 94px overlay (282px in this 3x PNG).
    const html = name === 'content_card' ? `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><style>
      body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:#f4f6f9}
      svg{display:block;width:100%;height:100%}
      .overlay{position:absolute;inset:auto 0 0;height:282px;background:#ffffff55;backdrop-filter:blur(18px)}
    </style></head><body><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 345 240" aria-label="Assets connected to a recipient">
      <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#f8fafc"/><stop offset="1" stop-color="#dbeafe"/></linearGradient></defs>
      <rect width="345" height="240" fill="url(#bg)"/>
      <circle cx="58" cy="75" r="68" fill="#eff6ff"/><circle cx="302" cy="208" r="95" fill="#dbeafe"/>
      <path d="M104 99H236" stroke="#93c5fd" stroke-width="2" stroke-dasharray="4 5"/>
      <rect x="84" y="44" width="100" height="93" rx="18" fill="#fff" stroke="#dbeafe"/>
      <path d="M104 72h44m-44 15h58m-58 15h31" stroke="#bfdbfe" stroke-width="5" stroke-linecap="round"/>
      <circle cx="86" cy="110" r="24" fill="#1e40af"/><circle cx="86" cy="110" r="15" fill="none" stroke="#eff6ff" stroke-width="2"/>
      <circle cx="183" cy="52" r="17" fill="#dbeafe"/><circle cx="183" cy="52" r="10" fill="none" stroke="#3b82f6" stroke-width="2"/>
      <path d="m205 92 7 7-7 7" fill="none" stroke="#1e40af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="235" y="72" width="48" height="56" rx="16" fill="#ffffff" stroke="#bfdbfe"/>
      <circle cx="259" cy="91" r="7" fill="#3b82f6"/><path d="M247 115c0-14 24-14 24 0" fill="#3b82f6"/>
    </svg><div class="overlay"></div></body></html>` : `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:#ffffff;color:#0f172a;font-family:${locale === 'ko' ? '"Noto Sans CJK KR","Noto Sans KR",Arial,sans-serif' : 'Arial,Helvetica,sans-serif'}}
      .orb{position:absolute;right:-130px;top:-60px;width:${height+200}px;height:${height+200}px;border-radius:50%;background:#eff6ff;border:1px solid #dbeafe}
      .brand{position:absolute;left:60px;top:50px;display:flex;align-items:center;gap:17px;font-size:29px;font-weight:600;letter-spacing:-.8px}
      .brand svg{width:53px;height:53px;border-radius:17px}
      .copy{position:absolute;left:60px;top:${top}px;width:${width-phoneWidth-screenRight-120}px;${locale === 'ko' ? 'word-break:keep-all' : ''}}
      .eyebrow{font-size:16px;letter-spacing:2px;color:#64748b;text-transform:uppercase;font-weight:600}
      h1{font-size:${titleSize}px;line-height:1.05;letter-spacing:${locale === 'ko' ? '-2px' : '-3px'};font-weight:500;margin:25px 0 27px;white-space:pre-line}
      .text{font-size:26px;line-height:1.4;color:#475569;max-width:470px;margin:0 0 36px}
      .detail{font-size:20px;line-height:1.6;color:#1e40af;max-width:420px}
      .screen{position:absolute;right:${screenRight}px;top:${Math.round((height-screenHeight)/2)}px;width:${phoneWidth}px;height:${screenHeight}px;overflow:hidden;border:5px solid #fff;border-radius:31px;box-shadow:0 18px 50px #0f172a22;background:#ffffff}
      .screen img{width:100%;height:100%;object-fit:cover;display:block}
      .footer{position:absolute;left:60px;bottom:39px;font-size:16px;color:#64748b;line-height:1.55;max-width:${width-phoneWidth-screenRight-120}px}
    </style></head><body><div class="orb"></div><div class="brand">${icon}<span>${locale === 'ko' ? '상속' : 'Inheritance'}</span></div><div class="copy"><div class="eyebrow">${locale === 'ko' ? '나의 상속 플랜' : 'A simple plan'}</div><h1>${esc(title)}</h1><p class="text">${esc(text)}</p><div class="detail">${esc(detail)}</div></div><div class="screen"><img alt="Actual example vault screen" src="${shots[shot]}"></div><div class="footer">inheritance.pages.dev<br>${locale === 'ko' ? '표시된 잔액과 수익률은 예시입니다.' : `Example screens. ${usdcStore || unifiedStore ? 'Balances and rates are illustrative.' : 'Balances are illustrative.'}`}</div></body></html>`;
    const {frameTree}=await page.send('Page.getFrameTree');
    await page.send('Page.setDocumentContent',{frameId:frameTree.frame.id,html});
    await page.ev('await Promise.all([...document.images].map(image=>image.decode())); await document.fonts.ready; return true;');
    if (name !== 'content_card') {
      const geometry = await page.ev(`const rect = el => { const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom}; }; const screen=rect(document.querySelector('.screen'));const copy=rect(document.querySelector('.copy'));const footer=rect(document.querySelector('.footer'));const lines=[...document.querySelectorAll('.brand span,.copy > *,.footer')].flatMap(el=>{const range=document.createRange();range.selectNodeContents(el);return [...range.getClientRects()].map(r=>({text:el.textContent,left:r.left,top:r.top,right:r.right,bottom:r.bottom}));});return {width:innerWidth,height:innerHeight,screen,copy,footer,lines};`);
      assert.ok(geometry.lines.every(line => line.left >= 0 && line.right <= geometry.screen.left - 24 && line.top >= 0 && line.bottom <= height), name + ' text stays within its reading area');
      assert.ok(geometry.copy.bottom <= geometry.footer.top - 24, name + ' copy clears the footer');
      compositionEvidence.images.push({ name, ...geometry });
    }
    const screenshot=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    const bytes=Buffer.from(screenshot.data,'base64');
    if(bytes.length>500*1024)throw new Error(name+' exceeds the portal size limit');
    writeFileSync(path.join(destination,name+'.png'),bytes);
    console.log(name+'.png',width+'x'+height,bytes.length,'bytes');
  } finally { await page.close(); }
}
if (!only || only.includes('logo')) {
  if (destination !== defaultDestination) copyFileSync(path.join(defaultDestination, 'logo.png'), path.join(destination, 'logo.png'));
  else {
    const logo=spawnSync('node',[path.join(root,'scripts/rasterize-icon.mjs')],{stdio:'inherit'});
    if(logo.status!==0)process.exit(logo.status||1);
  }
}
for(const name of [...(!only || only.includes('logo') ? ['logo'] : []),...selectedLayouts.map(layout=>layout.name)]){
  if(statSync(path.join(destination,name+'.png')).size>500*1024)throw new Error(name+' exceeds 500KB');
}
if (process.env.STORE_EVIDENCE_PATH) writeFileSync(process.env.STORE_EVIDENCE_PATH, JSON.stringify(compositionEvidence, null, 2));

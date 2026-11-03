// Use installed dependencies or the existing Codex runtime; never download a browser/package.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const appRequire=createRequire(new URL('../../app/package.json',import.meta.url));
export async function loadPlaywright(){
 if(process.env.PLAYWRIGHT_MODULE)return import(process.env.PLAYWRIGHT_MODULE.startsWith('/')?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:process.env.PLAYWRIGHT_MODULE);
 for(const name of ['playwright','@playwright/test']){try{return await import(pathToFileURL(appRequire.resolve(name)).href);}catch(error){if(error.code!=='MODULE_NOT_FOUND'&&error.code!=='ERR_MODULE_NOT_FOUND')throw error;}}
 const bundled=resolve(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
 if(existsSync(bundled))return import(pathToFileURL(bundled).href);
 throw Error('Playwright is unavailable. Set PLAYWRIGHT_MODULE to an existing installed Playwright module; no dependencies were installed.');
}
export function browserLaunchOptions(){
 const configured=process.env.CHROME_BIN;
 if(configured)return {headless:true,executablePath:configured};
 const macChrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 return existsSync(macChrome)?{headless:true,executablePath:macChrome}:{headless:true};
}

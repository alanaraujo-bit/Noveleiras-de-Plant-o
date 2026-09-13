import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
const browser = await chromium.launch({headless:true});
const page = await browser.newPage();
for (const [name,width,height] of [['desktop',1440,900],['mobile',390,844]]) {
 await page.setViewportSize({width,height});
 await page.goto('http://localhost:3100/bem-vindo', {waitUntil:'networkidle'});
 await page.screenshot({path:'.impeccable/review/'+name+'.png',fullPage:true});
 console.log(name,await page.title());
}
const icon = (await readFile('public/icones/noveleiras-512.png')).toString('base64');
const mask = (await readFile('public/icones/noveleiras-maskable-512.png')).toString('base64');
await page.setViewportSize({width:1000,height:620});
await page.setContent(`<html lang="pt-BR"><body style="margin:0;padding:48px;background:#130810;color:#fcf3ee;font:16px system-ui"><h1>Noveleiras</h1><p>Flor de conversa · ícone e recortes de instalação</p><div style="display:flex;align-items:center;gap:48px">${[[icon,256,'24%'],[mask,120,'50%'],[icon,64,'24%'],[icon,32,'20%']].map(([src,size,radius])=>`<div style="text-align:center"><img src="data:image/png;base64,${src}" width="${size}" height="${size}" style="border-radius:${radius}"/><p>${size} px</p></div>`).join('')}</div></body></html>`);
await page.screenshot({path:'.impeccable/review/marca.png'});
await browser.close();

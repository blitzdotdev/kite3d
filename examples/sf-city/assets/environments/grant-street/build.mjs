// Offline local bake. No external assets or reference photograph pixels are fetched.
import {build} from 'esbuild'
import {encodeRGBEScanlines} from './rgbe-rle.mjs'
import {chromium} from 'playwright'
import {createServer} from 'node:http'
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
const directory=fileURLToPath(new URL('.',import.meta.url)),temp=mkdtempSync(join(tmpdir(),'kite-street-hdr-'))
let browser,server
try {
 await build({entryPoints:[join(directory,'source.js')],bundle:true,format:'esm',outfile:join(temp,'app.js')})
 server=createServer((request,response)=>{response.setHeader('Content-Type',request.url==='/app.js'?'text/javascript':'text/html');response.end(request.url==='/app.js'?readFileSync(join(temp,'app.js')):'<script type="module" src="/app.js"></script>')})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>document.body.dataset.ready==='true',{},{timeout:60000})
 const data=encodeRGBEScanlines(Buffer.from(await page.evaluate(()=>window.environmentHDR),'base64'));writeFileSync(join(directory,'street.hdr'),data);console.log(`Baked authored street environment: ${data.length} bytes`)
}finally{await browser?.close();server?.close();rmSync(temp,{recursive:true,force:true})}

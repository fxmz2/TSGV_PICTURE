const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();const p=await b.newPage();
await p.goto('file://'+__dirname+'/handbuch.html');await p.waitForTimeout(1200);
await p.pdf({path:__dirname+'/Match-Shot_Handbuch.pdf',format:'A4',printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,
 headerTemplate:'<div></div>',
 footerTemplate:'<div style="width:100%;font-size:7.5pt;color:#8a93a6;padding:0 15mm;display:flex;justify-content:space-between;font-family:Arial"><span>Match-Shot · Handbuch &amp; FAQ</span><span class="pageNumber"></span></div>'});
await b.close()})();

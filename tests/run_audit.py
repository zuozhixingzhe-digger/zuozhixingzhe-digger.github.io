import asyncio, json, sys
from playwright.async_api import async_playwright
URL='file:///workspace/hterminal/index.html'
SRC=open('/workspace/hterminal/tests/audit.js').read()

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        ctx=await b.new_context(viewport={'width':1400,'height':900}, color_scheme='dark')
        pg=await ctx.new_page()
        errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('C:'+m.text) if m.type=='error' else None)
        await pg.goto(URL)
        await pg.wait_for_selector('#boot.gone', state='attached', timeout=60000)
        await pg.wait_for_timeout(500)
        await pg.evaluate("""(src) => { WindowManager.open({type:'shell', code:src, title:'audit'}); }""", SRC)
        for i in range(40):
            await pg.wait_for_timeout(500)
            txt = await pg.evaluate("""() => {
              const ks=[...WindowManager.windows.values()].filter(w=>w.type==='shell');
              const k=ks[ks.length-1];
              return k && k.content ? k.content.buf : null;
            }""")
            if txt and '汇总' in txt:
                break
        print(txt[-6000:] if txt else 'NO OUTPUT')
        print('ERRS', json.dumps(errs[:5], ensure_ascii=False))
        await b.close()
asyncio.run(main())

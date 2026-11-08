import asyncio, re, sys, json
from playwright.async_api import async_playwright
URL='file:///workspace/hterminal/index.html'
NAMES = sys.argv[1:] or ['html-particles']

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        ctx=await b.new_context(viewport={'width':1400,'height':900}, color_scheme='dark')
        pg=await ctx.new_page()
        errs=[]
        pg.on('pageerror', lambda e: errs.append('PAGE '+str(e)))
        pg.on('console', lambda m: errs.append('C:'+m.text) if m.type=='error' else None)
        await pg.goto(URL)
        await pg.wait_for_selector('#boot.gone', state='attached', timeout=60000)
        await pg.wait_for_timeout(500)
        await pg.evaluate("() => WindowManager.open({type:'shell', title:'t'})")
        await pg.wait_for_timeout(1200)
        for n in NAMES:
            await pg.evaluate("""(n) => {
              const ks=[...WindowManager.windows.values()].filter(w=>w.type==='shell');
              ks[ks.length-1].content._post({t:'in', data:'open(".bin.' + n + '")\\r'});
            }""", n)
            await pg.wait_for_timeout(2200)
            info = await pg.evaluate("""() => {
              const ws=[...WindowManager.windows.values()].filter(w=>w.type==='browser');
              const w=ws[ws.length-1];
              if(!w) return null;
              const f=w.body.querySelector('iframe');
              return {id:w.id, title:w.title, srcdoc:(f&&f.srcdoc||'').length, rect:w.el.getBoundingClientRect().toJSON()};
            }""")
            print(n, info)
            if info:
                await pg.screenshot(path='/workspace/html-%s.png' % n, clip={
                    'x':max(0,info['rect']['x']),'y':max(0,info['rect']['y']),
                    'width':min(info['rect']['width'],1400),'height':min(info['rect']['height'],900)})
                await pg.evaluate("(id) => WindowManager.close(id)", info['id'])
                await pg.wait_for_timeout(300)
        print('ERRS', json.dumps(errs[:8], ensure_ascii=False))
        await b.close()
asyncio.run(main())

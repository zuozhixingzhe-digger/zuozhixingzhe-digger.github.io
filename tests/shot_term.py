import asyncio, re
from playwright.async_api import async_playwright
URL='file:///workspace/hterminal/index.html'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        ctx=await b.new_context(viewport={'width':1440,'height':900}, color_scheme='dark')
        pg=await ctx.new_page()
        await pg.goto(URL); await pg.wait_for_selector('#boot.gone', state='attached', timeout=60000)
        await pg.wait_for_timeout(500)
        for name, wait, out in [('audit', 4000, 'shot-audit.png'), ('raytrace', 3000, 'shot-ray.png')]:
            await pg.evaluate("() => WindowManager.open({type:'shell', title:'t'})")
            await pg.wait_for_timeout(1200)
            await pg.evaluate("""(n) => { const ks=[...WindowManager.windows.values()].filter(w=>w.type==='shell'); ks[ks.length-1].content._post({t:'in', data:'await exec(".bin.'+n+'")\\r'}); }""", name)
            await pg.wait_for_timeout(wait)
            wid = await pg.evaluate("""() => { const ks=[...WindowManager.windows.values()].filter(w=>w.type==='shell'); const w=ks[ks.length-1]; w.el.style.width='900px'; w.el.style.height='640px'; w.el.style.left='60px'; w.el.style.top='70px'; return w.id; }""")
            await pg.wait_for_timeout(700)
            el = await pg.query_selector('.win:last-child')
            # 截当前窗口
            await pg.evaluate("""(id) => { const w=WindowManager.windows.get(id); WindowManager.focus(id); }""", wid)
            await pg.wait_for_timeout(500)
            box = await pg.evaluate("""(id) => { const w=WindowManager.windows.get(id); const r=w.el.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; }""", wid)
            await pg.screenshot(path='/workspace/'+out, clip={'x':max(0,box['x']),'y':max(0,box['y']),'width':min(box['w'],1400),'height':min(box['h'],880)})
            await pg.evaluate("(id) => WindowManager.close(id)", wid)
            await pg.wait_for_timeout(400)
        await b.close()
asyncio.run(main())

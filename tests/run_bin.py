import asyncio, re, sys, json
from playwright.async_api import async_playwright
URL='file:///workspace/hterminal/index.html'

async def run_one(pg, name, wait=9000):
    await pg.evaluate("() => WindowManager.open({type:'shell', title:'t'})")
    await pg.wait_for_timeout(1500)
    await pg.evaluate("""(n) => {
      const ks=[...WindowManager.windows.values()].filter(w=>w.type==='shell');
      ks[ks.length-1].content._post({t:'in', data:'await exec(".bin." + ' + JSON.stringify(n) + ')\\r'});
    }""", name)
    await pg.wait_for_timeout(wait)
    buf = await pg.evaluate("""() => {
      const ks=[...WindowManager.windows.values()].filter(w=>w.type==='shell');
      const last=ks[ks.length-1];
      const t=last.content.buf;
      WindowManager.close(last.id);
      return t;
    }""")
    clean = re.sub(r'\x1b\[[0-9;?]*[A-Za-z]', '', buf)
    return clean

async def main():
    names = sys.argv[1:] or ['audit']
    async with async_playwright() as p:
        b=await p.chromium.launch()
        ctx=await b.new_context(viewport={'width':1500,'height':950}, color_scheme='dark')
        pg=await ctx.new_page()
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL)
        await pg.wait_for_selector('#boot.gone', state='attached', timeout=60000)
        await pg.wait_for_timeout(500)
        for n in names:
            out = await run_one(pg, n)
            print('\n========== .bin.' + n + ' ==========')
            print(out[-3500:])
        print('ERRS', errs[:4])
        await b.close()
asyncio.run(main())

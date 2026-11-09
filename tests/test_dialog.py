"""对话框 / 拖拽遮罩 / 文件管理器 三件事的回归测试。

跑法：python3 tests/test_dialog.py
产物：/workspace/dlg-*.png、/workspace/fm-*.png
"""
import asyncio, json
from playwright.async_api import async_playwright

URL = 'file:///workspace/hterminal/index.html'


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1280, 'height': 820}, color_scheme='dark')
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append('PAGE ' + str(e)))
        pg.on('console', lambda m: errs.append('C:' + m.text) if m.type == 'error' else None)
        await pg.goto(URL)
        await pg.wait_for_selector('#boot.gone', state='attached', timeout=60000)
        await pg.wait_for_timeout(600)

        # ---- 1. 危险确认框 -------------------------------------------------
        await pg.evaluate("""() => { window.__r = 'pending';
            confirmDlg('确认要删除所有内容吗',
              '这会逐个删掉所有 IndexedDB 库、清空 localStorage / sessionStorage、删掉全部 Cache Storage，最后强制重载页面。',
              true).then(v => window.__r = v); }""")
        await pg.wait_for_timeout(350)
        await pg.screenshot(path='/workspace/dlg-danger.png')
        info = await pg.evaluate("""() => {
            const w = document.querySelector('.modal-wrap');
            const card = w.querySelector('.dlg-card');
            const orb = [...w.querySelectorAll('.dlg-orb')].map(o => o.getBoundingClientRect().toJSON());
            return {cls: card.className, title: card.querySelector('.dlg-title').textContent,
                    tw: card.querySelector('.dlg-title').getBoundingClientRect().toJSON(),
                    orbs: orb, trap: !!w.querySelector('.dlg-trap'),
                    blur: getComputedStyle(w).backdropFilter};
        }""")
        print('danger', json.dumps(info, ensure_ascii=False))

        # 点左边圆钮 = 取消
        await pg.click('.dlg-orb.cancel')
        await pg.wait_for_timeout(120)
        print('cancel orb ->', await pg.evaluate('window.__r'))

        # ---- 2. 绿箭头 + 点图标确认 ---------------------------------------
        await pg.evaluate("""() => { window.__r2 = 'pending';
            modalPrompt('重命名', 'notes', '新名字').then(v => window.__r2 = v); }""")
        await pg.wait_for_timeout(300)
        await pg.screenshot(path='/workspace/dlg-ask.png')
        print('ask orb class', await pg.evaluate("() => document.querySelector('.dlg-orb.ok') ? 'ok' : 'missing'"))
        await pg.fill('#mpIn', 'renamed')
        await pg.click('.dlg-orb.ok')
        await pg.wait_for_timeout(120)
        print('ok orb ->', await pg.evaluate('window.__r2'))

        # ---- 3. 单按钮提醒：不画把手 --------------------------------------
        await pg.evaluate("() => { modal({title:'关于 HTerMinaL', body:'<p>x</p>', buttons:[{label:'关闭', primary:true}]}); }")
        await pg.wait_for_timeout(300)
        await pg.screenshot(path='/workspace/dlg-info.png')
        print('info trap', await pg.evaluate("() => !!document.querySelector('.dlg-trap')"))
        # 点蒙层关掉
        await pg.mouse.click(60, 60)
        await pg.wait_for_timeout(150)
        print('mask closed', await pg.evaluate("() => !document.querySelector('.modal-wrap')"))

        # ---- 4. 拖拽遮罩：内部拖拽不能弹 ----------------------------------
        async def drag(kind):
            return await pg.evaluate("""(kind) => {
                const dt = new DataTransfer();
                const types = kind === 'internal' ? ['Files','application/x-ht-spot','text/plain']
                                                   : ['Files'];
                Object.defineProperty(dt, 'types', {get: () => types});
                const ev = new DragEvent('dragenter', {bubbles:true, cancelable:true, dataTransfer:dt});
                document.dispatchEvent(ev);
                return document.getElementById('dropVeil').classList.contains('on');
            }""", kind)
        print('veil internal', await drag('internal'))
        print('veil external', await drag('external'))
        await pg.wait_for_timeout(200)
        await pg.screenshot(path='/workspace/dlg-veil.png')
        # 松手（drop）必须收
        await pg.evaluate("""() => {
            const dt = new DataTransfer();
            Object.defineProperty(dt, 'types', {get: () => ['Files']});
            document.dispatchEvent(new DragEvent('drop', {bubbles:true, cancelable:true, dataTransfer:dt}));
        }""")
        await pg.wait_for_timeout(150)
        print('veil after drop', await pg.evaluate("() => document.getElementById('dropVeil').classList.contains('on')"))
        # 再弹一次，点 ✕ 关
        await drag('external')
        await pg.click('#dropVeilClose')
        await pg.wait_for_timeout(120)
        print('veil after close btn', await pg.evaluate("() => document.getElementById('dropVeil').classList.contains('on')"))
        # watchdog：不再有 dragover，1.5s 后自己收
        await drag('external')
        await pg.wait_for_timeout(2300)
        print('veil after watchdog', await pg.evaluate("() => document.getElementById('dropVeil').classList.contains('on')"))

        # ---- 5. 文件管理器：双击打开 + 工具栏打开/执行 ----------------------
        await pg.evaluate("() => WindowManager.open({type:'files', path:'.home', title:'文件'})")
        await pg.wait_for_timeout(700)
        await pg.screenshot(path='/workspace/fm-toolbar.png')
        row = await pg.evaluate("""() => {
            const r = [...document.querySelectorAll('.fm-row')].find(x => !x.querySelector('.nm').textContent.endsWith('.'));
            return r && r.dataset.p;
        }""")
        print('row', row)
        before = await pg.evaluate("() => [...WindowManager.windows.values()].length")
        if row:
            box = await pg.evaluate("""(p) => {
                const r = [...document.querySelectorAll('.fm-row')].find(x => x.dataset.p === p);
                r.scrollIntoView({block:'center'});
                return r.getBoundingClientRect().toJSON();
            }""", row)
            await pg.mouse.dblclick(box['x'] + 60, box['y'] + box['height'] / 2)
            await pg.wait_for_timeout(700)
        after = await pg.evaluate("() => [...WindowManager.windows.values()].map(w => w.type)")
        print('windows before/after', before, after)
        await pg.screenshot(path='/workspace/fm-dblclick.png')

        print('ERRS', json.dumps(errs[:10], ensure_ascii=False))
        await b.close()

asyncio.run(main())

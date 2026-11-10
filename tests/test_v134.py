"""0.0.1.34 回归测试（第八批次）

覆盖 20 条需求里可自动验证的部分：
  ① 启动态 = 一扇隐藏式最大化的普通终端窗口；单窗口时 Dock 不显示
  ② 最后一个窗口：不能最小化 / 不能改层级 / 红点变「朝左三角」
  ③ 最后一个窗口拖到底部 = 灰框 + 松手回原位（minsolo）
  ④ 关掉最后一个窗口 → exitDesktop（整页退出）
  ⑤ 隐藏式最大化时，四钮框与二级框**同时存在**，点外面才一起关
  ⑥ 抽屉可滑动关闭、且抽屉里的按钮点得动
  ⑦ 最大化后双击标题栏能还原（挂在窗口根上判顶部条带）
  ⑧ spotfs：建/读/覆盖写/追加全分开；元数据；能力表；自动文件名
  ⑨ .perm 可执行（= 申请授权），目录本身不可写
  ⑩ 文件管理器：空目录提示 / 右键菜单 / 预览折叠 / 按能力置灰 / 双击自动判断
  ⑪ 开普通窗口不唤起输入法（焦点不落在 input/textarea）
  ⑫ Markdown 的 Ctrl-B/I/U 与顶栏按钮
  ⑬ 贝塞尔设计器：拖控制点改曲线、小球动起来

跑：python3 tests/test_v134.py        （需要后端在 8787 上）
"""
import asyncio, json
from playwright.async_api import async_playwright

URL = "http://127.0.0.1:8787/"


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 1280, "height": 800})
        errs = []
        pg.on("pageerror", lambda e: errs.append("pageerror:" + str(e)[:220]))
        pg.on("console", lambda m: errs.append("console:" + m.text[:220]) if m.type == "error" else None)
        await pg.goto(URL, wait_until="load")
        await pg.wait_for_function("typeof WindowManager!=='undefined'&&TerminalManager.desktop&&TerminalManager.desktop.worker", timeout=25000)
        await pg.wait_for_timeout(1500)
        out = {}

        # ---------------------------------------------------------------- ① 启动态
        out["boot"] = await pg.evaluate("""() => ({
          wins: WindowManager.windows.size,
          list: [...WindowManager.windows.values()].map(w => ({ t: w.type, mode: w.mode, cls: w.el.className })),
          dockHidden: document.getElementById('dockWrap').hidden,
          dockLen: document.getElementById('dock').innerHTML.length,
          chip: document.getElementById('hidChip').classList.contains('on'),
          termInsideWin: !!TerminalManager.desktop.container.closest('.win'),
          focusInTerm: !!document.activeElement.closest('.xterm')
        })""")

        # ---------------------------------------------------------------- ②③④ 最后的窗口
        out["solo_rules"] = await pg.evaluate("""async () => {
          const w = [...WindowManager.windows.values()][0];
          const red = w.el.querySelector('.win-dot.c svg path') || w.el.querySelector('.win-dot.c svg');
          const r = { solo: w.el.classList.contains('solo'),
                      redPath: red ? (red.getAttribute('d') || '').slice(0, 26) : null,
                      dotMTitle: w.el.querySelector('.win-dot.m').title,
                      dotBTitle: w.el.querySelector('.win-dot.b').title };
          WindowManager.minimize(w.id); await sleep(180);
          r.minRejected = w.minimized === false && w.mode !== 'min';
          const z0 = +w.el.style.zIndex || 0;
          WindowManager.sendToBack(w.id); await sleep(80);
          r.backRejected = (+w.el.style.zIndex || 0) === z0 && WindowManager.windows.size === 1;
          return r;
        }""")

        # 拖到底部：框要变灰（data-pos=minsolo），松手回原位
        pos = await pg.evaluate("""async () => {
          const w = [...WindowManager.windows.values()][0];
          WindowManager.maxMode(w.id, 'normal'); await sleep(360);
          const r = w.el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + 12, left: Math.round(r.left), top: Math.round(r.top) };
        }""")
        await pg.mouse.move(pos["x"], pos["y"])
        await pg.mouse.down()
        await pg.wait_for_timeout(60)
        for i in range(1, 11):
            await pg.mouse.move(pos["x"], pos["y"] + i * 55)
            await pg.wait_for_timeout(16)
        out["snap_bottom"] = await pg.evaluate("""() => { const s = document.getElementById('winSnap');
          return { pos: s.dataset.pos || null,
                   shown: getComputedStyle(s).display !== 'none',
                   grey: getComputedStyle(s).borderColor }; }""")
        await pg.mouse.up()
        await pg.wait_for_timeout(600)
        out["snap_bottom"]["bouncedBack"] = await pg.evaluate("""() => { const w = [...WindowManager.windows.values()][0];
          const r = w.el.getBoundingClientRect();
          return { mode: w.mode, minimized: w.minimized, left: Math.round(r.left), top: Math.round(r.top) }; }""")
        out["snap_bottom"]["wasAt"] = {"left": pos["left"], "top": pos["top"]}

        # ---------------------------------------------------------------- ⑤ 四钮框两级共存
        out["menu_two_levels"] = await pg.evaluate("""async () => {
          const w = [...WindowManager.windows.values()][0];
          WindowManager.maxMode(w.id, 'hidden'); await sleep(200);
          DotMenu.open(document.getElementById('hidChip'), w.id); await sleep(150);
          const g = document.querySelector('.dotmenu [data-a="max"]');
          const r = g.getBoundingClientRect();
          g.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, button:0, pointerType:'mouse', clientX:r.left+8, clientY:r.top+8 }));
          await sleep(760);
          g.dispatchEvent(new PointerEvent('pointerup', { bubbles:true, button:0, pointerType:'mouse' }));
          await sleep(220);
          const o = { dotmenu: !!document.querySelector('.dotmenu'), winmenu: !!document.querySelector('.winmenu'),
                      lv2: !!document.querySelector('.winmenu.lv2'),
                      title: (document.querySelector('.winmenu__title') || {}).textContent || null };
          document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true }));
          await sleep(200);
          o.after = { dotmenu: !!document.querySelector('.dotmenu'), winmenu: !!document.querySelector('.winmenu') };
          return o;
        }""")

        # ---------------------------------------------------------------- ⑥ 抽屉
        out["drawer"] = await pg.evaluate("""async () => {
          document.querySelector('[data-act="more"]').click(); await sleep(650);
          /* ① 抽屉里的真控件（字号滑杆）必须点得动：以前滑动绑定把 click 全吞了 */
          const rng = document.getElementById('setFont');
          const f0 = Settings.get('font');
          rng.value = String(+f0 + 3);
          rng.dispatchEvent(new Event('input', { bubbles:true }));
          rng.dispatchEvent(new Event('change', { bubbles:true }));
          await sleep(240);
          const f1 = Settings.get('font');
          /* ② 抽屉里的窗口条目点一下就切窗（并且抽屉该收） */
          const btn = document.querySelector('#drawer .drawer__win, #drawer [data-app]');
          const name = btn ? btn.textContent.trim().slice(0, 10) : null;
          const before = WindowManager.windows.size;
          if (btn) btn.click();
          await sleep(500);
          return { opened: Drawer.opened, fontBefore: f0, fontAfter: f1,
                   btn: name, winsBefore: before, winsAfter: WindowManager.windows.size };
        }""")
        # 快扫关闭
        await pg.evaluate("""async () => { if (!Drawer.opened) { document.querySelector('[data-act="more"]').click(); await sleep(650); } }""")
        dpos = await pg.evaluate("""() => { const d = document.getElementById('drawer'), r = d.getBoundingClientRect();
          return { x: r.left + 40, y: r.top + 300 }; }""")
        await pg.mouse.move(dpos["x"], dpos["y"])
        await pg.mouse.down()
        for i in range(1, 7):
            await pg.mouse.move(dpos["x"] + i * 22, dpos["y"] + 2)
            await pg.wait_for_timeout(10)
        await pg.mouse.up()
        await pg.wait_for_timeout(520)
        out["drawer"]["swipeClosed"] = await pg.evaluate("() => Drawer.opened")

        # ---------------------------------------------------------------- ⑦ 双击还原最大化
        out["dblclick"] = await pg.evaluate("""async () => {
          const w = [...WindowManager.windows.values()].find(x => x.type === 'shell');
          if (w.mode !== 'normal') WindowManager.maxMode(w.id, 'normal');
          await sleep(260);
          const hit = () => { const r = w.el.getBoundingClientRect();
            w.el.dispatchEvent(new MouseEvent('dblclick', { bubbles:true, clientX:r.left+r.width/2, clientY:r.top+18 })); };
          hit(); await sleep(420);
          const up = w.mode;
          hit(); await sleep(420);
          const back = w.mode;
          hit(); await sleep(420);
          return { afterFirst: up, afterSecond: back, afterThird: w.mode };
        }""")

        # ---------------------------------------------------------------- ⑧ spotfs
        out["spotfs"] = await pg.evaluate("""async () => {
          const r = {};
          try { await FS.sptn('.home.t134', { data:'x' }); r.sptnWithData = 'NO-THROW'; }
          catch (e) { r.sptnWithData = e.message.slice(0, 24); }
          const st = await FS.sptn('.home.t134');
          r.created = { path: st.path, size: st.size, content: String(st.content || '') };
          await FS.sptc('.home.t134', 'hello');
          const ro = await FS.sptr('.home.t134');
          await FS.spta('.home.t134', '!');
          const ra = await FS.sptr('.home.t134');
          r.rw = { afterWrite: String(ro.content), afterAppend: String(ra.content) };
          await FS.sptmetawrite('.home.t134', { type:'text', mime:'text/plain', extra:{ tag:'demo' } });
          const m = await FS.sptmetaread('.home.t134');
          r.meta = { type: m.type, mime: m.mime, tag: m.extra && m.extra.tag, readonly: m.readonly };
          r.caps = { root: FS.caps('.'), home: FS.caps('.home'), doc: FS.caps('.doc.about'),
                     perm: FS.caps('.perm.notification'), qf: FS.caps('.queryfile.x') };
          const a1 = await FS.sptn('.home'), a2 = await FS.sptn('.home');
          r.auto = [a1.path, a2.path];
          try { await FS.sptn('.should-fail'); r.rootMk = 'NO-THROW'; } catch (e) { r.rootMk = e.message.slice(0, 26); }
          r.permX = await FS.sptx('.perm.notification');
          r.spot = { hasSpot: typeof Spot === 'object', type: await Spot.typeOf('.doc.license') };
          for (const x of ['.home.t134', a1.path, a2.path]) { try { await FS.sptd(x); } catch (e) {} }
          return r;
        }""")

        # queryfile：只读、不可写、读一次就永久消失（peek 不算读）
        out["queryfile"] = await pg.evaluate("""async () => {
          const o = {};
          const rec = { path:'.queryfile.sim', parent:'.queryfile', name:'sim', kind:'file',
                        content:'secret', meta:{ hint:'用户交进来的' },
                        ctime:Date.now(), mtime:Date.now(), size:6 };
          await IDB.put(rec);
          FS.idx.set(rec.path, { path:rec.path, parent:rec.parent, name:rec.name, kind:'file',
                                 size:6, mtime:rec.mtime, ctime:rec.ctime, meta:rec.meta });
          const pk = await FS.sptr('.queryfile.sim', { peek:true });
          o.peek = { content:String(pk.content), stillThere: !!FS.idx.get('.queryfile.sim') };
          const rd = await FS.sptr('.queryfile.sim');
          o.read = { content:String(rd.content), consumed: !!rd.consumed, gone: !FS.idx.get('.queryfile.sim') };
          try { await FS.sptr('.queryfile.sim'); o.second = 'NO-THROW'; } catch (e) { o.second = e.message.slice(0, 20); }
          try { await FS.sptc('.queryfile.sim', 'x'); o.write = 'NO-THROW'; } catch (e) { o.write = e.message.slice(0, 18); }
          return o;
        }""")

        # ⑨ .perm 只读 + 可执行
        out["perm_dir"] = await pg.evaluate("""async () => {
          const r = {};
          try { await FS.sptc('.perm.evil', 'x'); r.write = 'NO-THROW'; } catch (e) { r.write = e.message.slice(0, 22); }
          try { await FS.sptr('.perm.notification'); r.read = 'NO-THROW'; } catch (e) { r.read = e.message.slice(0, 22); }
          const x = await FS.sptx('.perm.clipboard');
          r.exec = x && x.act;
          return r;
        }""")

        # ---------------------------------------------------------------- ⑩ 文件管理器
        out["fm"] = await pg.evaluate("""async () => {
          const w = WindowManager.open({ type:'files', path:'.home' }); await sleep(650);
          const app = w.content, root = w.el;
          const rows = [...root.querySelectorAll('.fm-row')].map(x => x.dataset.p);
          await FS.sptn('.home.empty', { kind:'dir' });
          app.path = '.home.empty'; await app.load(); await sleep(200);
          const empty = root.querySelector('.fm-empty') ? root.querySelector('.fm-empty').textContent.trim().slice(0, 18) : null;
          app.path = '.home'; await app.load(); await sleep(200);
          const row = root.querySelector('.fm-row');
          row.dispatchEvent(new MouseEvent('contextmenu', { bubbles:true, clientX:220, clientY:220 }));
          await sleep(200);
          const ctx = document.querySelector('.fmctx');
          const items = ctx ? [...ctx.querySelectorAll('[data-cmd]')].map(x => ({ c:x.dataset.cmd, off:x.disabled })) : null;
          if (ctx) ctx.remove();
          app.act('preview'); await sleep(150);
          const pvOff = !!root.querySelector('.fm.pv-off');
          app.act('preview'); await sleep(80);
          app.sel = '.perm.notification'; app._syncBar();
          const bar = { run: root.querySelector('[data-a="run"]').disabled,
                        edit: root.querySelector('[data-a="edit"]').disabled,
                        del:  root.querySelector('[data-a="del"]').disabled };
          app.sel = '.doc.license'; app._syncBar();
          const barDoc = { run: root.querySelector('[data-a="run"]').disabled,
                           edit: root.querySelector('[data-a="edit"]').disabled };
          await FS.sptd('.home.empty');
          return { rows: rows.length, empty, items, pvOff, bar, barDoc };
        }""")

        # ---------------------------------------------------------------- ⑪ 焦点
        out["focus"] = await pg.evaluate("""async () => {
          document.activeElement && document.activeElement.blur && document.activeElement.blur();
          const before = document.activeElement.tagName;
          const w = WindowManager.open({ type:'timer' }); await sleep(700);
          const a = document.activeElement;
          return { before, after: a.tagName + '.' + (a.className || ''),
                   isField: /^(INPUT|TEXTAREA)$/.test(a.tagName) || a.isContentEditable,
                   inside: w.el.contains(a) };
        }""")

        # ---------------------------------------------------------------- ⑫ Markdown 快捷键
        out["markdown"] = await pg.evaluate("""async () => {
          const w = WindowManager.open({ type:'markdown' }); await sleep(700);
          const ta = w.el.querySelector('textarea');
          const hasTb = !!w.el.querySelector('.md-tb');
          ta.focus(); ta.value = 'abc'; ta.setSelectionRange(0, 3);
          ta.dispatchEvent(new KeyboardEvent('keydown', { key:'b', ctrlKey:true, bubbles:true }));
          await sleep(150);
          const bold = ta.value;
          ta.value = 'xyz'; ta.setSelectionRange(0, 3);
          ta.dispatchEvent(new KeyboardEvent('keydown', { key:'u', ctrlKey:true, bubbles:true }));
          await sleep(150);
          return { hasTb, bold, underline: ta.value, btns: w.el.querySelectorAll('.md-tb [data-fmt]').length };
        }""")

        # ---------------------------------------------------------------- ⑬ 贝塞尔
        out["bezier"] = await pg.evaluate("""async () => {
          const w = WindowManager.open({ type:'bezier' }); await sleep(700);
          const cv = w.el.querySelector('canvas'), r = cv.getBoundingClientRect();
          const css0 = w.el.querySelector('.bz-css').textContent.trim();
          const pd = (t, x, y) => cv.dispatchEvent(new PointerEvent(t, { bubbles:true, pointerId:1, clientX:x, clientY:y }));
          pd('pointerdown', r.left + 90, r.top + r.height - 70);
          pd('pointermove', r.left + 150, r.top + 70);
          pd('pointerup',   r.left + 150, r.top + 70);
          await sleep(260);
          return { css0, css1: w.el.querySelector('.bz-css').textContent.trim(),
                   ball: w.el.querySelector('.bz-ball').style.transform };
        }""")

        # ---------------------------------------------------------------- ⑭ .sys → .doc
        out["doc_dir"] = await pg.evaluate("""async () => {
          const l = await FS.list('.');
          return { dirs: l.map(x => x.path || x.name).slice(0, 12),
                   hasDoc: !!FS.idx.get('.doc'), hasSys: !!FS.idx.get('.sys') };
        }""")

        # ---------------------------------------------------------------- ⑤b 关掉最后一个窗口 → 退出整页
        out["exit_on_last"] = await pg.evaluate("""async () => {
          for (const w of [...WindowManager.windows.values()]) if (w.type !== 'shell') WindowManager.close(w.id);
          await sleep(300);
          const left = [...WindowManager.windows.values()];
          let hit = 0;
          const orig = window.exitDesktop;
          window.exitDesktop = () => { hit++; };
          if (left.length) WindowManager.close(left[0].id);
          await sleep(420);
          window.exitDesktop = orig;
          return { before: left.length, hit, remain: WindowManager.windows.size };
        }""")

        out["errs"] = errs[:10]
        print(json.dumps(out, ensure_ascii=False, indent=1))
        await b.close()


asyncio.run(main())

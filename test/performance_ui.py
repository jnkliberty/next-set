import json, math, re, sys
from pathlib import Path
from time import perf_counter, monotonic
from playwright.sync_api import sync_playwright

report=[]
with sync_playwright() as p:
    for engine in [p.chromium,p.webkit]:
        browser=engine.launch()
        context=browser.new_context(viewport={'width':390,'height':844},timezone_id='America/Chicago')
        page=context.new_page()
        page.set_default_timeout(10000)
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        try:
            if engine.name=='chromium':context.new_cdp_session(page).send('Emulation.setCPUThrottlingRate',{'rate':4})
            assert page.request.post(sys.argv[1]+'/__reset').ok
            pages=[]
            page.on('response',lambda response: pages.append(response) if '/api/changes?' in response.url else None)
            start=perf_counter();page.goto(sys.argv[1])
            page.locator('header.app-top').wait_for()
            deadline=monotonic()+120
            while not page.evaluate('''async()=>{
                const db=await new Promise(resolve=>{const r=indexedDB.open('workout-tracker');r.onsuccess=()=>resolve(r.result)});
                const count=await new Promise(resolve=>{const r=db.transaction('event').objectStore('event').count();r.onsuccess=()=>resolve(r.result)});db.close();return count>=20000;
            }'''):
                assert monotonic()<deadline,'First download exceeded 120 seconds'
                page.wait_for_timeout(100)
            page.get_by_role('button',name=re.compile(r'^Start Day \d+$')).wait_for()
            cold_ms=(perf_counter()-start)*1000
            print(f'{engine.name}: cold download {cold_ms:.1f} ms',flush=True)
            payload=sum(len(response.body()) for response in pages)
            counts=page.evaluate('''async()=>{
                const db=await new Promise(resolve=>{const r=indexedDB.open('workout-tracker');r.onsuccess=()=>resolve(r.result)});
                const names=['program','program_day','slot','slot_set','exercise','session','set','event'];
                const pairs=await Promise.all(names.map(name=>new Promise(resolve=>{const r=db.transaction(name).objectStore(name).count();r.onsuccess=()=>resolve([name,r.result])})));db.close();return Object.fromEntries(pairs);
            }''')
            assert all(counts[k]==n for k,n in {'program':11,'program_day':390,'slot':5282,'slot_set':17500,'exercise':1082,'session':200,'set':5400}.items()),counts
            page.wait_for_function('navigator.serviceWorker.controller !== null')
            page.request.post(sys.argv[1]+'/__stop')
            start=perf_counter();page.reload(wait_until='domcontentloaded')
            page.get_by_role('button',name=re.compile(r'^Start Day \d+$')).wait_for()
            open_ms=(perf_counter()-start)*1000
            print(f'{engine.name}: offline open {open_ms:.1f} ms',flush=True)
            context.set_offline(True)
            page.get_by_role('button',name=re.compile(r'^Start Day \d+$')).click()
            for i in range(20):
                page.locator('.logger').wait_for()
                # Lifts without fixture history ask for a starting weight.
                weight=page.locator('.set-row:not(.done) input[id^="weight-"]').first
                if weight.count() and weight.input_value()=='':weight.fill('50')
                page.get_by_role('button',name=re.compile('^Log set')).first.click()
                try:page.get_by_role('button',name='Skip',exact=True).click()
                except Exception:
                    print({'iteration':i,'headings':page.locator('h1').all_text_contents(),'buttons':page.locator('.rest-bar button').all_text_contents(),'errors':page.get_by_role('alert').all_text_contents()},flush=True)
                    raise
            saves=page.evaluate('''async()=>{
                const db=await new Promise(resolve=>{const r=indexedDB.open('workout-tracker');r.onsuccess=()=>resolve(r.result)});
                const rows=await new Promise(resolve=>{const r=db.transaction('event').objectStore('event').getAll();r.onsuccess=()=>resolve(r.result)});db.close();return rows.filter(row=>row.kind==='logged').map(row=>row.detail.saveMs).sort((a,b)=>a-b);
            }''')
            assert len(saves)==20,len(saves)
            result={'engine':engine.name,'cpu_slowdown':4 if engine.name=='chromium' else 'native (WebKit has no CDP throttle)','counts':counts,'download_ms':round(cold_ms,1),'payload_bytes':payload,'pages':len(pages),'max_page_bytes':max(len(response.body()) for response in pages),'offline_open_ms':round(open_ms,1),'save_p95_ms':round(saves[math.ceil(.95*len(saves))-1],2),'save_max_ms':round(max(saves),2)}
            report.append(result);print(json.dumps(result),flush=True)
            assert open_ms<1000,result
            assert saves[math.ceil(.95*len(saves))-1]<50,result
        except Exception:
            print({'engine':engine.name,'headings':page.locator('h1').all_text_contents(),'buttons':page.locator('button').all_text_contents()[:25],'errors':errors,'alerts':page.get_by_role('alert').all_text_contents()},flush=True)
            print(page.evaluate('''async()=>{
                const db=await new Promise(resolve=>{const r=indexedDB.open('workout-tracker');r.onsuccess=()=>resolve(r.result)});
                const names=[...db.objectStoreNames];const result=await Promise.all(names.map(name=>new Promise(resolve=>{const r=db.transaction(name).objectStore(name).count();r.onsuccess=()=>resolve([name,r.result])})));db.close();return Object.fromEntries(result);
            }'''),flush=True)
            raise
        finally:
            context.close();browser.close()
Path('data/proof').mkdir(parents=True,exist_ok=True)
Path('data/proof/full-size-performance.json').write_text(json.dumps(report,indent=2)+'\n')

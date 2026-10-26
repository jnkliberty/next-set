"""Faults exercise the production phone store against a temporary fixture server."""
import sys
import urllib.request
from time import monotonic, sleep
from datetime import datetime
from zoneinfo import ZoneInfo

async def bounded(operation):
    return await asyncio.wait_for(operation, timeout=15)
from playwright.async_api import async_playwright
import asyncio

async def ready(context, url):
    page = await bounded(context.new_page())
    await bounded(page.goto(url + '/__fault'))
    await bounded(page.evaluate("Promise.race([window.faultReady,new Promise((_,reject)=>setTimeout(()=>reject(Error('Store startup exceeded 15 seconds')),15000))])"))
    return page

async def save(page, changes):
    return await bounded(page.evaluate('changes=>window.faultStore.save(changes)', changes))

def base(i, engine):
    root = f'fault-{engine}-{i}'
    date = datetime.now(ZoneInfo('America/Chicago')).date().isoformat()
    return (root, [{'table': 'session', 'row': {'id': root + '-session', 'started_at': 1792690000000, 'ended_at': 1792690100000, 'timezone': 'America/Chicago', 'local_date': date, 'status': 'done', 'source': 'app'}}, {'table': 'session_slot', 'row': {'id': root + '-slot', 'session_id': root + '-session', 'position': 0, 'exercise_id': 'press', 'name': 'Fixture lift'}}, {'table': 'set', 'row': {'id': root, 'session_slot_id': root + '-slot', 'position': 0, 'type': 'working', 'weight': 40, 'unit': 'kg', 'grams': 40000, 'reps': 6, 'done_at': 1792690100000, 'local_date': date}}])

async def run(engine, url, count):
    urllib.request.urlopen(urllib.request.Request(url + '/__reset', method='POST')).close()
    browser = await bounded(engine.launch())
    context = await bounded(browser.new_context(timezone_id='America/Chicago'))
    page = await ready(context, url)
    try:
        for i in range(count):
            started = monotonic()
            (root, changes) = base(i, engine.name)
            before = await bounded(page.evaluate("window.faultStore.db.get('meta','cursor')")) or 0
            mode = i % 8
            expected = 40
            if mode == 0:
                await bounded(context.set_offline(True))
            await save(page, changes)
            if mode == 0:
                await bounded(page.evaluate('window.savedNow=Date.now;Date.now=()=>window.savedNow()+259200000'))
                await save(page, [{'table': 'set', 'row': {'id': root, 'weight': 41, 'grams': 41000}}])
                expected = 41
                await bounded(page.evaluate('Date.now=window.savedNow'))
                await bounded(context.set_offline(False))
            elif mode == 1:
                await bounded(page.evaluate('id=>Promise.all([1,2].map(()=>window.faultStore.save([{table:"set",row:{id,weight:42,grams:42000}}])))', root))
                expected = 42
            elif mode == 2:
                await bounded(page.evaluate("() => {window.nativeFetch=fetch;window.held=false;window.fetch=async(...args)=>{const response=await window.nativeFetch(...args);if(!window.held&&String(args[0]).includes('/api/sync')){window.held=true;await new Promise(resolve=>window.release=resolve);}return response;};window.inflight=window.faultStore.sync();}"))
                try:
                    await bounded(page.wait_for_function('window.held && !!window.release', timeout=5000))
                except Exception as error:
                    raise AssertionError({'run': i, 'state': await bounded(page.evaluate('window.lastSync')), 'held': await bounded(page.evaluate('window.held')), 'waiting': await bounded(page.evaluate('window.faultStore.status()'))}) from error
                await save(page, [{'table': 'set', 'row': {'id': root, 'weight': 43, 'grams': 43000}}])
                expected = 43
                await bounded(page.evaluate('window.release();'))
                await bounded(page.evaluate('window.inflight'))
                await bounded(page.evaluate('window.fetch=window.nativeFetch'))
                assert (await bounded(page.evaluate('window.faultStore.status()')))['waiting'] == 0, 'An in-flight edit waited for another sync call'
            elif mode == 3:
                other = await ready(context, url)
                when = await bounded(page.evaluate('Date.now()+100'))
                for (target, value) in [(page, 44), (other, 45)]:
                    await bounded(target.evaluate("arg=>{window.race=new Promise(resolve=>setTimeout(resolve,Math.max(0,arg.when-Date.now()))).then(()=>window.faultStore.save([{table:'set',row:{id:arg.id,weight:arg.value,grams:arg.value*1000}}]));}", {'when': when, 'id': root, 'value': value}))
                left = (await bounded(page.evaluate('window.race')))['rows'][0]['row']
                right = (await bounded(other.evaluate('window.race')))['rows'][0]['row']
                assert abs(left['rev'] - right['rev']) == 1
                expected = max([left, right], key=lambda row: row['rev'])['weight']
                await bounded(other.evaluate('window.faultStore.sync()'))
                await bounded(other.close())
            elif mode == 4:
                await bounded(page.evaluate('window.savedNow=Date.now;Date.now=()=>window.savedNow()+86400000'))
                await save(page, [{'table': 'set', 'row': {'id': root, 'weight': 46, 'grams': 46000}}])
                await bounded(page.evaluate('Date.now=()=>window.savedNow()-86400000'))
                await save(page, [{'table': 'set', 'row': {'id': root, 'weight': 47, 'grams': 47000}}])
                expected = 47
                await bounded(page.evaluate('Date.now=window.savedNow'))
            elif mode == 5:
                await bounded(page.close())
                page = await ready(context, url)
            elif mode == 6:
                extra = [{'table': 'set', 'row': {**changes[-1]['row'], 'id': root + f'-mid-{n}'}} for n in range(20)]
                await bounded(page.evaluate('changes=>{window.mid=window.faultStore.save(changes)}', extra))
                await bounded(page.close())
                page = await ready(context, url)
                n = await bounded(page.evaluate('prefix=>window.faultStore.db.getAll("set").then(rows=>rows.filter(row=>row.id.startsWith(prefix)).length)', root + '-mid-'))
                assert n in [0, 20], n
            elif mode == 7:
                state = await bounded(context.storage_state(indexed_db=True))
                await bounded(context.close())
                context = await bounded(browser.new_context(timezone_id='Asia/Tokyo' if i // 8 % 2 else 'Pacific/Honolulu', storage_state=state))
                page = await ready(context, url)
            await bounded(page.evaluate('window.faultStore.sync()'))
            status = await bounded(page.evaluate('window.faultStore.status()'))
            assert status['waiting'] == 0, (engine.name, i, status['waiting'], status.get('error'), await bounded(page.evaluate('window.lastSync')))
            check = await bounded(page.evaluate('window.faultStore.check()'))
            assert check.get('ok') is True, (engine.name, i, check.get('ok'))
            changed = (await bounded((await bounded(page.request.get(url + f'/api/changes?since={before}'))).json()))['rows']
            actual = next((item['row'] for item in changed if item['table'] == 'set' and item['row']['id'] == root))
            assert actual['weight'] == expected, (engine.name, i, actual['weight'], expected)
            assert actual['done_at'] is not None
            await asyncio.sleep(max(0, 0.75 - (monotonic() - started)))
            if (i + 1) % 25 == 0:
                print(f'{engine.name}: {i + 1}/{count} fault runs, zero lost or doubled sets', flush=True)
        print(f'PASS P4 {engine.name}: {count} runs, all final edits match; outbox and count checks agree', flush=True)
    finally:
        await bounded(context.close())
        await bounded(browser.close())

async def main():
    async with async_playwright() as playwright:
        for engine in [playwright.chromium, playwright.webkit]:
            await run(engine, sys.argv[1], int(sys.argv[2]))
asyncio.run(main())

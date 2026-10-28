"""Regression checks use only the invented browser fixture."""
import re
import sys
from pathlib import Path
from time import monotonic
from playwright.sync_api import sync_playwright, expect
from app_ui import rows, expand_exercises


def wait_for_async(page, expression):
    # Playwright treats an async predicate's Promise as truthy before it resolves.
    deadline = monotonic() + 15
    while not page.evaluate(expression):
        assert monotonic() < deadline, 'Fixture state did not become ready'
        page.wait_for_timeout(50)


def update_rows(page, table, patches):
    page.evaluate('''async ({table, patches}) => {
        const db = await new Promise(resolve => { const request = indexedDB.open('workout-tracker'); request.onsuccess = () => resolve(request.result); });
        const tx = db.transaction(table, 'readwrite'), store = tx.objectStore(table);
        for (const patch of patches) { const get = store.get(patch.id); get.onsuccess = () => store.put({...get.result, ...patch}); }
        await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; }); db.close();
        const channel = new BroadcastChannel('workout-tracker'); channel.postMessage('changed'); channel.close();
    }''', {'table': table, 'patches': patches})


def run(engine, url):
    browser = engine.launch()
    context = browser.new_context(viewport={'width': 390, 'height': 844})
    page = context.new_page()
    errors = []
    # A disconnected WebKit fetch can emit its network error as a pageerror.
    page.on('pageerror', lambda error: errors.append(str(error)) if not (engine.name == 'webkit' and 'due to access control checks' in str(error) and '/api/' in str(error)) else None)
    try:
        page.request.post(url + '/__reset')
        page.goto(url)
        page.get_by_role('button', name=re.compile('Sample Strength')).click()
        page.get_by_role('button', name='Start Day 1', exact=True).click()
        expand_exercises(page)
        press = page.get_by_role('article', name='Bench Press', exact=True)
        weight = press.get_by_role('textbox', name='Set 1 weight in kg', exact=True)
        weight.fill('107.5')
        press.get_by_role('textbox', name='Set 1 reps', exact=True).fill('5')
        page.get_by_role('button', name='Home', exact=True).click()
        page.get_by_role('button', name='Resume workout', exact=True).click()
        expand_exercises(page)
        expect(weight).to_have_value('107.5')
        expect(press.get_by_role('textbox', name='Set 1 reps', exact=True)).to_have_value('5')
        assert not [row for row in rows(page, 'set') if row.get('done_at') and not row['id'].startswith('past-')]
        page.wait_for_function('navigator.serviceWorker.controller !== null')
        # WebKit's network emulation rejects offline navigation before the worker can handle it.
        if engine.name == 'chromium':
            context.set_offline(True)
        else:
            page.request.post(url + '/__stop')
        page.reload(wait_until='domcontentloaded')
        expand_exercises(page)
        expect(weight).to_have_value('107.5')
        press.get_by_role('button', name='Weight in kg. Switch to lb', exact=True).click()
        pounds = press.get_by_role('textbox', name='Set 1 weight in lb', exact=True)
        expect(pounds).to_have_value('237')
        assert any(isinstance(row, dict) and row.get('unit') == 'lb' for row in rows(page, 'meta'))
        page.reload()
        expand_exercises(page)
        expect(pounds).to_have_value('237')
        row = page.get_by_role('article', name='Barbell Row', exact=True)
        row.get_by_role('button', name='Weight in kg. Switch to lb', exact=True).click()
        page.get_by_role('button', name='Home', exact=True).click()
        page.get_by_role('button', name='Resume workout', exact=True).click()
        expand_exercises(page)
        row_weight = row.get_by_role('textbox', name='Set 1 weight in lb', exact=True)
        expect(row_weight).to_have_value('')
        row_weight.fill('137.79')
        press.get_by_role('button', name='Log set 1', exact=True).click()
        expect(press.get_by_role('button', name='Undo set 1', exact=True)).to_be_visible()
        assert not [row for row in rows(page, 'meta') if isinstance(row, dict) and row.get('values', {}).get('weight') == '237']
        page.wait_for_timeout(1050)
        set_id = pounds.get_attribute('id').removeprefix('weight-')
        page.evaluate("""id => { window.originalUndoPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(value, key) {
            if (this.name === 'meta' && Array.isArray(key) && key[0] === 'draft' && key[2] === id) throw new Error('Fixture rejected Undo draft');
            return window.originalUndoPut.apply(this, arguments);
        }; }""", set_id)
        press.get_by_role('button', name='Undo set 1', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('Undo did not save.')
        assert next(saved for saved in rows(page, 'set') if saved['id'] == set_id)['done_at'] is not None
        page.evaluate('() => { IDBObjectStore.prototype.put = window.originalUndoPut; }')
        page.get_by_role('button', name='Dismiss', exact=True).click()
        page.wait_for_timeout(1050)
        press.get_by_role('button', name='Undo set 1', exact=True).click()
        page.reload()
        expand_exercises(page)
        expect(pounds).to_have_value('237')
        expect(press.get_by_role('textbox', name='Set 1 reps', exact=True)).to_have_value('5')
        context.set_offline(False)
        wait_for_async(page, "async () => { try { return (await fetch('/api/health', {cache:'no-store'})).ok; } catch { return false; } }")
        assert not errors, errors
        print(f'PASS {engine.name}: draft survives Home, reload, offline, unit change, log and Undo')
    except Exception:
        print(engine.name, page.locator('body').inner_text()[:1500], [row for row in rows(page, 'meta') if isinstance(row, dict) and 'unit' in row], errors)
        raise
    finally:
        context.close()
        browser.close()


def picker(engine, url):
    browser = engine.launch()
    context = browser.new_context(viewport={'width': 390, 'height': 844})
    page = context.new_page()
    try:
        page.request.post(url + '/__reset')
        page.goto(url)
        page.get_by_role('button', name=re.compile('Sample Strength')).click()
        page.get_by_role('button', name='Edit day', exact=True).click()
        page.get_by_role('button', name='+ Add exercise', exact=True).click()
        before = rows(page, 'session')
        star = page.get_by_role('button', name='Favorite Decline Press', exact=True)
        star.focus()
        page.keyboard.press('Space')
        expect(star).to_have_attribute('aria-pressed', 'true')
        expect(page.get_by_role('button', name='Pick exercises', exact=True)).to_be_disabled()
        assert rows(page, 'session') == before
        expect(page.locator('.exercise-choice .list-row').first).to_contain_text('Decline Press')
        page.get_by_role('button', name='Favorites', exact=True).click()
        expect(page.locator('.exercise-choice')).to_have_count(1)
        star.click()
        expect(page.get_by_role('button', name='Favorites', exact=True)).to_have_count(0)
        expect(page.locator('.exercise-choice')).to_have_count(3)
        star.click()
        page.get_by_role('button', name='Close', exact=True).click()
        page.reload()
        page.get_by_role('button', name='Edit day', exact=True).click()
        page.get_by_role('button', name='+ Add exercise', exact=True).click()
        expect(star).to_have_attribute('aria-pressed', 'true')
        context.set_offline(True)
        star.click(); expect(star).to_have_attribute('aria-pressed', 'false')
        star.click(); expect(star).to_have_attribute('aria-pressed', 'true')
        assert next(r for r in rows(page, 'setting') if r['id'] == 'favorite:decline')['value'] is True
        context.set_offline(False)
        page.get_by_role('button', name='Close', exact=True).click()
        page.locator('header.app-top button').first.click()
        wait_for_async(page, "async () => { const db=await new Promise(r=>{const q=indexedDB.open('workout-tracker');q.onsuccess=()=>r(q.result)}); const n=await new Promise(r=>{const q=db.transaction('outbox').objectStore('outbox').count();q.onsuccess=()=>r(q.result)});db.close();return n===0; }")
        second = browser.new_context()
        try:
            other = second.new_page(); other.goto(url)
            other.get_by_role('button', name='Edit day', exact=True).click()
            other.get_by_role('button', name='+ Add exercise', exact=True).click()
            expect(other.get_by_role('button', name='Favorite Decline Press', exact=True)).to_have_attribute('aria-pressed', 'true')
        finally:
            second.close()
        operations = [{'id': f'picker-{i}', 'table': 'exercise', 'row': {'id': f'picker-{i}', 'rev': 1, 'device_id': 'fixture', 'updated_at': 1, 'deleted_at': None, 'name': f'Fixture option {i:02}', 'equipment': 'barbell', 'primary': ['chest'], 'secondary': [], 'weight_basis': 'total', 'conditioning': False}} for i in range(65)]
        answer = page.evaluate("async operations => (await fetch('/api/sync', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operations})})).json()", operations)
        assert 'results' in answer and all(result['status'] == 'applied' for result in answer['results']), answer
        page.reload()
        wait_for_async(page, "async () => { const db=await new Promise(r=>{const q=indexedDB.open('workout-tracker');q.onsuccess=()=>r(q.result)});const n=await new Promise(r=>{const q=db.transaction('exercise').objectStore('exercise').count();q.onsuccess=()=>r(q.result)});db.close();return n===68; }")
        page.get_by_role('button', name='Edit day', exact=True).click()
        page.get_by_role('button', name='+ Add exercise', exact=True).click()
        expect(page.locator('.exercise-choice')).to_have_count(60)
        page.get_by_role('button', name='Show more', exact=True).click()
        expect(page.locator('.exercise-choice')).to_have_count(68)
        page.get_by_role('button', name=re.compile('^Fixture option 64')).click()
        page.get_by_role('searchbox', name='Search exercises', exact=True).fill('Decline Press')
        page.get_by_role('button', name=re.compile('^Decline Press')).click()
        expect(page.get_by_role('button', name='Add 2 exercises', exact=True)).to_be_enabled()
        assert rows(page, 'session') == before
        proof = Path('data/proof/opengym-build'); proof.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(proof / f'{engine.name}-favorites.png'))
        print(f'PASS {engine.name}: favorite keyboard action, ranking/filter, reload, offline sync to second client, all 68 results, retained batch picks')
    finally:
        context.close()
        browser.close()


def superset(engine, url):
    browser = engine.launch()
    context = browser.new_context(viewport={'width': 390, 'height': 844})
    page = context.new_page()
    proof = Path('data/proof/opengym-build'); proof.mkdir(parents=True, exist_ok=True)
    try:
        page.request.post(url + '/__reset')
        page.goto(url)
        page.get_by_role('button', name=re.compile('Sample Strength')).click()
        page.get_by_role('button', name='Edit day', exact=True).click()
        page.get_by_role('button', name='Change Bench Press', exact=True).click()
        page.get_by_role('button', name='Superset with next exercise', exact=True).click()
        page.get_by_role('button', name='Close', exact=True).click()
        page.get_by_role('button', name='Resume workout', exact=True).click()
        expand_exercises(page)
        press = page.get_by_role('article', name='Bench Press', exact=True)
        row = page.get_by_role('article', name='Barbell Row', exact=True)
        press.get_by_role('button', name='Exercise menu for Bench Press', exact=True).click()
        expect(page.locator('.target-reason')).to_contain_text('Suggested target: 102.5 kg × 4.')
        expect(page.locator('.target-reason')).to_contain_text('next weight is suggested')
        page.screenshot(path=str(proof / f'{engine.name}-target.png'))
        page.get_by_role('button', name='Close', exact=True).click()
        row.get_by_role('button', name='Weight in kg. Switch to lb', exact=True).click()
        row_weight = row.get_by_role('textbox', name='Set 1 weight in lb', exact=True)
        expect(row_weight).to_have_value('')
        press.get_by_role('textbox', name='Set 1 weight in kg', exact=True).fill('107.5')
        press.get_by_label('Set 1 reps',exact=True).fill('4')
        press.get_by_role('button', name='Log set 1', exact=True).click()
        expect(row.locator('[aria-current=step]')).to_contain_text('1')
        expect(page.get_by_role('region', name='Rest', exact=True)).to_have_count(0)
        press.get_by_role('button', name='Exercise menu for Bench Press', exact=True).click()
        expect(page.locator('.target-reason')).to_contain_text('Suggested target: 107.5 kg × 4.')
        expect(page.locator('.target-reason')).to_contain_text('earlier set today')
        page.get_by_role('button', name='Close', exact=True).click()
        page.get_by_role('button', name='Home', exact=True).click()
        expect(page.get_by_text('Next: Barbell Row, set 1', exact=True)).to_be_visible()
        page.get_by_role('button', name='Resume workout', exact=True).click()
        expand_exercises(page)
        row_weight.fill('137.79')
        row.get_by_label('Set 1 reps',exact=True).fill('6')
        row.get_by_role('button', name='Log set 1', exact=True).dblclick(delay=20)
        expect(page.get_by_role('timer')).to_be_visible()
        page.get_by_role('button', name='+15 s', exact=True).click()
        page.get_by_role('button', name='Home', exact=True).click()
        page.get_by_role('button', name='Resume workout', exact=True).click()
        expand_exercises(page)
        assert int(page.get_by_role('timer').get_attribute('aria-label').split()[0]) >= 100
        for width in [390, 1440, 1920]:
            page.set_viewport_size({'width': width, 'height': 1000})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(proof / f'{engine.name}-superset-{width}.png'))
        page.get_by_role('button', name='Skip', exact=True).click()
        page.get_by_role('button', name='Home', exact=True).click()
        page.get_by_role('button', name='Resume workout', exact=True).click()
        expand_exercises(page)
        expect(page.get_by_role('region', name='Rest', exact=True)).to_have_count(0)
        expect(press.locator('[aria-current=step]')).to_contain_text('2')
        row.get_by_role('button', name='Undo set 1', exact=True).click()
        expect(row.locator('[aria-current=step]')).to_contain_text('1')
        expect(row_weight).to_have_value('137.79')
        page.wait_for_timeout(1050)
        row.get_by_role('button', name='Log set 1', exact=True).click()
        page.get_by_role('button', name='Skip', exact=True).click()
        press.get_by_role('textbox', name='Set 2 weight in kg', exact=True).fill('102.5')
        press.get_by_label('Set 2 reps',exact=True).fill('4')
        press.get_by_role('button', name='Log set 2', exact=True).click()
        expect(page.get_by_role('region', name='Rest', exact=True)).to_have_count(0)
        row.get_by_role('textbox', name='Set 2 weight in lb', exact=True).fill('137.79')
        row.get_by_label('Set 2 reps',exact=True).fill('6')
        row.get_by_role('button', name='Log set 2', exact=True).click()
        page.locator('.cta').get_by_role('button', name='Finish workout', exact=True).click()
        expect(page.get_by_role('heading', name='Workout complete', exact=True)).to_be_visible()
        expect(page.get_by_role('timer')).to_have_count(0)
        logged = [r for r in rows(page, 'set') if r.get('done_at') and not r['id'].startswith('past-')]
        assert len(logged) == 4 and len({r['id'] for r in logged}) == 4
        print(f'PASS {engine.name}: superset guidance, Resume, double tap, rest extension/Skip, Undo, target reasons and automatic finish')
    finally:
        context.close()
        browser.close()


def draft_conflicts(engine, url):
    browser = engine.launch()
    context = browser.new_context(viewport={'width': 390, 'height': 844})
    page = context.new_page()
    try:
        page.request.post(url + '/__reset')
        page.goto(url)
        page.get_by_role('button', name=re.compile('Sample Strength')).click()
        page.get_by_role('button', name='Start Day 1', exact=True).click()
        expand_exercises(page)
        press = page.get_by_role('article', name='Bench Press', exact=True)
        weight = press.get_by_role('textbox', name='Set 1 weight in kg', exact=True)
        weight.fill('1,')
        page.get_by_role('button', name='Home', exact=True).click()
        page.get_by_role('button', name='Resume workout', exact=True).click()
        expand_exercises(page)
        expect(weight).to_have_value('1,')
        weight.fill('107.5')
        set_id = weight.get_attribute('id').removeprefix('weight-')
        update_rows(page, 'set', [{'id': set_id, 'weight': 120}])
        expect(press.get_by_role('button', name='Log set 1', exact=True)).to_be_disabled()
        expect(weight).to_have_value('107.5')
        press.get_by_role('button', name='Keep my draft', exact=True).click()
        expect(press.get_by_role('button', name='Log set 1', exact=True)).to_be_enabled()
        update_rows(page, 'set', [{'id': set_id, 'weight': 125}])
        press.get_by_role('button', name='Use saved values', exact=True).click()
        expect(weight).to_have_value('125')
        weight.fill('112.5')
        press.get_by_label('Set 1 reps',exact=True).fill('6')
        page.evaluate("() => { window.originalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(...args) { if (this.name === 'outbox') throw new Error('Fixture rejected log'); return window.originalPut.apply(this, args); }; }")
        press.get_by_role('button', name='Log set 1', exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('Fixture rejected log')
        page.evaluate('() => { IDBObjectStore.prototype.put = window.originalPut; }')
        page.get_by_role('button', name='Dismiss', exact=True).click()
        page.get_by_role('button', name='Home', exact=True).click()
        page.get_by_role('button', name='Resume workout', exact=True).click()
        expand_exercises(page)
        expect(weight).to_have_value('112.5')
        pending = [r for r in rows(page, 'set') if not r['id'].startswith('past-')]
        assert all(r.get('done_at') is None for r in pending)
        row_slot = next(r['id'] for r in rows(page, 'session_slot') if r.get('name') == 'Barbell Row' and not r['id'].startswith('past-'))
        update_rows(page, 'set', [{'id': r['id'], 'type': 'timed', 'seconds': 30, 'target_seconds': 30} for r in pending if r['session_slot_id'] == row_slot])
        seconds = page.get_by_role('article', name='Barbell Row').get_by_role('textbox', name='Set 1 seconds', exact=True)
        seconds.fill('047')
        page.get_by_role('button', name='Home', exact=True).click()
        page.get_by_role('button', name='Resume workout', exact=True).click()
        expand_exercises(page)
        expect(seconds).to_have_value('047')
        page.evaluate("() => { window.originalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(...args) { if (this.name === 'meta' && Array.isArray(args[1]) && args[1][0] === 'draft') throw new Error('Fixture draft failure'); return window.originalPut.apply(this, args); }; }")
        seconds.fill('048')
        expect(page.get_by_role('alert')).to_contain_text('These edits did not save')
        page.get_by_role('button', name='Home', exact=True).click()
        expect(seconds).to_be_visible()
        page.evaluate('() => { IDBObjectStore.prototype.put = window.originalPut; }')
        page.get_by_role('button', name='Dismiss', exact=True).click()
        page.get_by_role('button', name='Home', exact=True).click()
        page.get_by_role('button', name='Resume workout', exact=True).click()
        expand_exercises(page)
        expect(seconds).to_have_value('048')
        update_rows(page, 'set', [{'id': set_id, 'weight': 130, 'done_at': 1}])
        expect(weight).to_have_attribute('readonly', '')
        expect(weight).to_have_value('130')
        print(f'PASS {engine.name}: raw/timed drafts, conflict choices, completed-row protection, failed log and failed draft recovery')
    finally:
        context.close()
        browser.close()


with sync_playwright() as playwright:
    for engine in [playwright.chromium, playwright.webkit]:
        run(engine, sys.argv[1])
        picker(engine, sys.argv[1])
        superset(engine, sys.argv[1])
        draft_conflicts(engine, sys.argv[1])

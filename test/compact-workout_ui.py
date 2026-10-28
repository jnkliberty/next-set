"""Compact workout and blank-entry regressions use invented fixture data only."""
import re
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from app_ui import rows


def open_card(scope, name):
    # The current exercise now opens itself; open any other card only when it is still closed.
    toggle = scope.get_by_role('button', name=re.compile(rf'^(Expand|Collapse) {re.escape(name)}$'))
    if toggle.get_attribute('aria-expanded') == 'false':
        toggle.click()


def run(engine, url):
    browser = engine.launch()
    context = browser.new_context(viewport={'width': 390, 'height': 844})
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.request.post(url + '/__reset')
        page.goto(url)
        page.get_by_role('button', name=re.compile('Sample Strength')).click()
        page.get_by_role('button', name='Start Day 1', exact=True).click()
        press = page.get_by_role('article', name='Bench Press', exact=True)
        toggle = press.get_by_role('button', name=re.compile(r'^(Expand|Collapse) Bench\ Press$'))
        # The current exercise opens itself; collapse it to check the compact row.
        expect(toggle).to_have_attribute('aria-expanded', 'true')
        expect(press.get_by_role('table')).to_have_count(1)
        expect(page.get_by_role('button', name=re.compile(r'^(Expand|Collapse) Barbell Row$'))).to_have_attribute('aria-expanded', 'false')
        toggle.click()
        expect(toggle).to_have_attribute('aria-expanded', 'false')
        expect(press.get_by_role('heading', level=2)).to_be_visible()
        assert press.get_by_role('heading', level=2).evaluate('(node) => node.tagName') == 'H2'
        expect(toggle).to_have_accessible_description('2 sets · 4 to 6 reps')
        expect(toggle).to_contain_text('2 sets · 4 to 6 reps')
        expect(press.get_by_role('table')).to_have_count(0)
        assert toggle.bounding_box()['height'] >= 44
        bounds = toggle.bounding_box()
        page.mouse.move(bounds['x'] + 20, bounds['y'] + 20)
        page.mouse.down()
        page.mouse.move(bounds['x'] + 100, bounds['y'] + 20, steps=8)
        page.mouse.up()
        expect(page.get_by_role('button', name='Remove', exact=True)).to_be_visible()
        expect(toggle).to_have_attribute('aria-expanded', 'false')
        toggle.focus()
        page.keyboard.press('Enter')
        weight = press.get_by_role('textbox', name='Set 1 weight in kg', exact=True)
        reps = press.get_by_role('textbox', name='Set 1 reps', exact=True)
        expect(weight).to_have_value('')
        expect(reps).to_have_value('')
        press.get_by_role('button', name='100 × 6 Use last for set 1', exact=True).click()
        expect(weight).to_have_value('100')
        expect(reps).to_have_value('6')
        assert not [row for row in rows(page, 'set') if row.get('done_at') and not row['id'].startswith('past-')]
        reps.fill('')
        expect(press.locator('.last button > span').first).to_have_text('100 × 6')
        weight.fill('107.5')
        press.get_by_role('button', name='Log set 1', exact=True).click()
        expect(reps).to_be_focused()
        assert not [row for row in rows(page, 'set') if row.get('done_at') and not row['id'].startswith('past-')]
        reps.fill('5')
        press.get_by_role('button', name='Collapse Bench Press', exact=True).click()
        expect(press.get_by_role('table')).to_have_count(0)
        open_card(press, 'Bench Press')
        expect(weight).to_have_value('107.5')
        expect(reps).to_have_value('5')
        press.get_by_role('button', name='+ Add set', exact=True).click()
        expect(press.get_by_role('textbox', name='Set 3 reps', exact=True)).to_have_value('')
        expect(press.get_by_role('textbox', name='Set 3 weight in kg', exact=True)).to_have_value('')
        # Remove set takes the last unlogged set; Undo brings back the row and its typed draft.
        press.get_by_role('textbox', name='Set 3 reps', exact=True).fill('7')
        press.get_by_role('button', name='− Remove set', exact=True).click()
        expect(press.get_by_role('textbox', name='Set 3 reps', exact=True)).to_have_count(0)
        page.get_by_role('button', name='Undo', exact=True).click()
        expect(press.get_by_role('textbox', name='Set 3 reps', exact=True)).to_have_value('7')
        proof = Path('data/proof/compact-workout'); proof.mkdir(parents=True, exist_ok=True)
        for width in [320, 390, 1440]:
            page.set_viewport_size({'width': width, 'height': 900})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            assert press.locator('.last').first.evaluate('(node) => node.clientWidth >= 52 && node.scrollWidth <= node.clientWidth')
            assert press.locator('.set-table input, .set-table button').evaluate_all('(nodes) => nodes.every(node => node.getBoundingClientRect().width >= 44)')
            title = press.locator('.exercise-name')
            title.evaluate('(node) => node.textContent = "UnbrokenExerciseName".repeat(5)')
            assert title.bounding_box()['x'] + title.bounding_box()['width'] <= press.locator('.icon-button').bounding_box()['x']
            assert title.evaluate('(node) => node.scrollWidth <= node.clientWidth')
            title.evaluate('(node) => node.textContent = "Bench Press"')
            page.screenshot(path=str(proof / f'{engine.name}-expanded-{width}.png'))
        page.get_by_role('button', name='Home', exact=True).click()
        page.get_by_role('button', name='Resume workout', exact=True).click()
        open_card(press, 'Bench Press')
        expect(weight).to_have_value('107.5')
        expect(reps).to_have_value('5')
        page.wait_for_function('navigator.serviceWorker.controller !== null')
        page.reload()
        open_card(press, 'Bench Press')
        expect(weight).to_have_value('107.5')
        expect(reps).to_have_value('5')
        context.set_offline(True)
        press.get_by_role('button', name='Log set 1', exact=True).click()
        expect(press.get_by_role('button', name='Undo set 1', exact=True)).to_be_visible()
        expect(weight).to_have_value('107.5')
        expect(reps).to_have_value('5')
        expect(weight).to_have_attribute('readonly', '')
        expect(press.get_by_role('textbox', name='Set 2 reps', exact=True)).to_have_value('')
        saved = [row for row in rows(page, 'set') if row.get('done_at') and not row['id'].startswith('past-')]
        assert len(saved) == 1 and saved[0]['weight'] == 107.5 and saved[0]['reps'] == 5
        press.get_by_role('button', name='Collapse Bench Press', exact=True).click()
        expect(press.locator('.exercise-summary')).to_have_text('1 of 3 sets · 4 to 6 reps')
        page.set_viewport_size({'width': 390, 'height': 844})
        page.screenshot(path=str(proof / f'{engine.name}-collapsed.png'))
        assert not errors, errors
        print(f'PASS {engine.name}: compact disclosure, blank kg/reps, Last, validation, collapse/Home/reload drafts, offline save and completed values')
    finally:
        context.close()
        browser.close()


def patch(page, table, row):
    page.evaluate("""async ({table,row}) => {
      const db=await new Promise(resolve=>{const q=indexedDB.open('workout-tracker');q.onsuccess=()=>resolve(q.result)});
      const tx=db.transaction(table,'readwrite'),store=tx.objectStore(table),get=store.get(row.id);
      get.onsuccess=()=>store.put({...get.result,...row});
      await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=reject});db.close();
      const channel=new BroadcastChannel('workout-tracker');channel.postMessage('changed');channel.close();
    }""", {'table':table,'row':row})


def notices(engine, url):
    browser = engine.launch()
    context = browser.new_context(viewport={'width': 390, 'height': 844})
    page = context.new_page()
    try:
        page.request.post(url + '/__reset')
        page.goto(url)
        page.get_by_role('button', name=re.compile('Sample Strength')).click()
        page.get_by_role('button', name='Start Day 1', exact=True).click()
        context.set_offline(True)
        press = page.get_by_role('article', name='Bench Press', exact=True)
        row = page.get_by_role('article', name='Barbell Row', exact=True)
        expect(press.locator('.exercise-notices')).to_be_empty()
        press.locator('.exercise-notices').evaluate('(node) => window.fixtureNotice = node')
        slot = next(r for r in rows(page, 'session_slot') if r.get('name') == 'Barbell Row' and not r['id'].startswith('past-'))
        for member in [r for r in rows(page, 'session_slot') if not r['id'].startswith('past-')]:
            patch(page, 'session_slot', {'id':member['id'],'group_id':'fixture-group'})
        expect(press.get_by_role('button', name=re.compile(r'^(Expand|Collapse) Bench\ Press$'))).to_have_accessible_description(re.compile(r'(Group|Superset) A1.*2 sets'))
        patch(page, 'setting', {'id':'return:'+slot['id'],'rev':1,'device_id':'fixture','updated_at':1,'deleted_at':None,'value':{'choice':None,'days':30,'recommended':0}})
        expect(row.get_by_role('status')).to_contain_text('Choose your starting weight.')
        expect(row.get_by_role('button', name=re.compile(r'^(Expand|Collapse) Barbell\ Row$'))).to_have_attribute('aria-expanded','false')
        row.get_by_role('button', name=re.compile(r'^(Expand|Collapse) Barbell\ Row$')).click()
        row.get_by_role('button', name=re.compile('^Same')).click()
        expect(row.locator('.return')).to_have_count(0)
        row.get_by_role('button', name='Collapse Barbell Row').click()
        expect(row.locator('.exercise-notices')).to_be_empty()
        open_card(press, 'Bench Press')
        weight = press.get_by_role('textbox', name='Set 1 weight in kg', exact=True)
        weight.fill('107.5')
        press.get_by_role('textbox', name='Set 1 reps', exact=True).fill('5')
        set_id = weight.get_attribute('id').removeprefix('weight-')
        press.get_by_role('button', name='Collapse Bench Press').click()
        patch(page, 'set', {'id':set_id,'weight':120})
        expect(press.get_by_role('status')).to_contain_text('A set changed elsewhere.')
        expect(press.get_by_role('button', name=re.compile(r'^(Expand|Collapse) Bench\ Press$'))).to_have_attribute('aria-expanded','false')
        press.get_by_role('button', name=re.compile(r'^(Expand|Collapse) Bench\ Press$')).click()
        press.get_by_role('button', name='Keep my draft').click()
        expect(press.get_by_role('alert')).to_have_count(0)
        press.get_by_role('button', name='Collapse Bench Press').click()
        expect(press.locator('.exercise-notices')).to_be_empty()
        press.get_by_role('button', name=re.compile(r'^(Expand|Collapse) Bench\ Press$')).click()
        weight.fill('250')
        press.get_by_role('button', name='Log set 1', exact=True).click()
        expect(press.get_by_role('button', name='Log anyway')).to_be_visible()
        press.get_by_role('button', name='Collapse Bench Press').click()
        expect(press.get_by_role('status')).to_contain_text('A higher weight needs confirmation.')
        press.get_by_role('button', name=re.compile(r'^(Expand|Collapse) Bench\ Press$')).click()
        press.get_by_role('button', name='Change', exact=True).click()
        press.get_by_role('button', name='Collapse Bench Press').click()
        expect(press.locator('.exercise-notices')).to_be_empty()
        expect(row.get_by_role('button', name=re.compile(r'^(Expand|Collapse) Barbell\ Row$'))).to_have_attribute('aria-expanded','false')
        assert press.locator('.exercise-notices').evaluate('(node) => node === window.fixtureNotice')
        print(f'PASS {engine.name}: native heading, collapsed return/conflict/high-weight notices and resolution without opening other exercises')
    finally:
        context.close()
        browser.close()


def actions(engine, url):
    browser = engine.launch()
    context = browser.new_context(viewport={'width': 390, 'height': 844})
    page = context.new_page()
    try:
        page.request.post(url + '/__reset')
        page.goto(url)
        page.get_by_role('button', name=re.compile('Sample Strength')).click()
        page.get_by_role('button', name='Start Day 1', exact=True).click()
        context.set_offline(True)
        press = page.get_by_role('article', name='Bench Press', exact=True)
        row = page.get_by_role('article', name='Barbell Row', exact=True)
        for member in [r for r in rows(page, 'session_slot') if not r['id'].startswith('past-')]:
            patch(page, 'session_slot', {'id':member['id'],'group_id':'fixture-superset','group_kind':'superset'})
        expect(page.get_by_role('button', name='Next: Bench Press, set 1', exact=True)).to_be_visible()
        row.get_by_role('button', name=re.compile(r'^(Expand|Collapse) Barbell\ Row$')).click()
        row_weight = row.get_by_role('textbox', name='Set 1 weight in kg', exact=True)
        row_weight.fill('62.5')
        row.get_by_role('textbox', name='Set 1 reps', exact=True).fill('5')
        row.get_by_role('button', name='Collapse Barbell Row').click()
        page.get_by_role('button', name='Next: Bench Press, set 1', exact=True).click()
        expect(press.get_by_role('textbox', name='Set 1 weight in kg', exact=True)).to_be_focused()
        press.get_by_role('button', name='Weight in kg. Switch to lb', exact=True).click()
        press.get_by_role('button', name=re.compile(r'Use last for set 1$')).click()
        expect(press.get_by_role('textbox', name='Set 1 weight in lb', exact=True)).to_have_value('220.46')
        expect(press.get_by_role('textbox', name='Set 1 reps', exact=True)).to_have_value('6')
        press.get_by_role('button', name='Log set 1', exact=True).click()
        expect(page.get_by_role('button', name='Next: Barbell Row, set 1', exact=True)).to_be_visible()
        expect(row.get_by_role('button', name=re.compile(r'^(Expand|Collapse) Barbell\ Row$'))).to_have_attribute('aria-expanded','false')
        page.get_by_role('button', name='Next: Barbell Row, set 1', exact=True).click()
        expect(row_weight).to_be_focused()
        expect(row_weight).to_have_value('62.5')
        expect(row.get_by_role('textbox', name='Set 1 reps', exact=True)).to_have_value('5')
        expect(page.get_by_label('Why are you stopping?')).to_have_count(0)
        page.get_by_role('button', name='Finish workout', exact=True).click()
        finish = page.get_by_role('dialog', name='Finish workout?', exact=True)
        expect(finish.get_by_label('Why are you stopping?')).to_be_visible()
        finish.get_by_label('Why are you stopping?').select_option('time')
        finish.get_by_role('button', name='Keep working', exact=True).click()
        expect(finish).to_have_count(0)
        expect(row_weight).to_have_value('62.5')
        assert len([r for r in rows(page,'set') if r.get('done_at') and not r['id'].startswith('past-')]) == 1
        current = next(r for r in rows(page,'set') if r['id'] == row_weight.get_attribute('id').removeprefix('weight-'))
        for entry in [r for r in rows(page,'set') if r.get('session_slot_id') == current['session_slot_id']]:
            patch(page,'set',{'id':entry['id'],'type':'timed','seconds':None,'target_seconds':30})
        patch(page,'set',{'id':current['reference_set_id'],'seconds':42,'type':'timed'})
        # Changing the fixture's set type invalidates its existing weight draft.
        row.get_by_role('button', name='Use saved values').click()
        row.get_by_role('button', name='42 s Use last for set 1', exact=True).click()
        expect(row.get_by_role('textbox', name='Set 1 seconds', exact=True)).to_have_value('42')
        assert len([r for r in rows(page,'set') if r.get('done_at') and not r['id'].startswith('past-')]) == 1
        page.get_by_role('button', name='Finish workout', exact=True).click()
        finish.get_by_role('button', name='Finish workout', exact=True).click()
        expect(page.get_by_role('heading', name='Finished early', exact=True)).to_be_visible()
        choice = next(r for r in rows(page,'event') if r.get('detail',{}).get('integration',{}).get('recordType') == 'session_choice')
        assert choice['detail']['integration']['reason'] == 'time'
        print(f'PASS {engine.name}: Use last kg/lb/timed without logging, explicit superset Next preserves drafts, on-demand Finish sheet cancel/confirm')
    finally:
        context.close()
        browser.close()


with sync_playwright() as playwright:
    for engine in [playwright.chromium, playwright.webkit]:
        run(engine, sys.argv[1])
        notices(engine, sys.argv[1])
        actions(engine, sys.argv[1])

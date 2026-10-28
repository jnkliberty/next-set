"""Real app checks with fabricated training rows only."""
import json
import re
import sys
import urllib.request
from time import perf_counter, monotonic
from pathlib import Path
from playwright.sync_api import sync_playwright, expect


def rows(page, table):
    return page.evaluate("""async table => {
      const request=indexedDB.open('workout-tracker');
      const db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
      const tx=db.transaction(table);const get=tx.objectStore(table).getAll();
      const result=await new Promise((resolve,reject)=>{get.onsuccess=()=>resolve(get.result);get.onerror=()=>reject(get.error)});db.close();return result;
    }""", table)


def expand_exercises(page):
    page.locator('.exercise').first.wait_for()
    for toggle in page.locator('.exercise button[aria-expanded]').all():
        if toggle.get_attribute('aria-expanded')=='false':
            toggle.click()


TYPE_SCALE={11,13,15,17,22,34}
def assert_type_scale(page,name):
    # Every visible text node uses a size from the design scale (test/design.test.js holds the CSS side).
    sizes=page.evaluate('''[...new Set([...document.querySelectorAll('body *')].filter(e=>e.getClientRects().length&&[...e.childNodes].some(n=>n.nodeType==3&&n.textContent.trim())).map(e=>parseFloat(getComputedStyle(e).fontSize)))]''')
    assert set(sizes)<=TYPE_SCALE,(name,sorted(sizes))

def capture_views(page,engine,screenshots):
    for name in ['Home','Calendar','Program','Progress']:
        page.get_by_role('navigation',name='Main').get_by_role('button',name=name,exact=True).click()
        page.screenshot(path=str(screenshots/f'{engine.name}-{"workout" if name=="Home" else name.lower()}.png'))
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),name
        for width in [320,375,768,1920]:
            page.set_viewport_size({'width':width,'height':844})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(name,width)
        page.set_viewport_size({'width':390,'height':844})
        assert_type_scale(page,name)
        if name=='Program':
            assert page.locator('.app-top,.field .top').count()==1
            page.get_by_role('button',name='Options',exact=True).click();page.screenshot(path=str(screenshots/f'{engine.name}-options.png'));page.get_by_role('button',name='Close',exact=True).click()
        if name=='Progress':
            page.get_by_role('button',name=re.compile('See sets')).first.click();page.screenshot(path=str(screenshots/f'{engine.name}-history.png'));page.get_by_role('button',name='Close',exact=True).click()


def run(engine, url):
    urllib.request.urlopen(urllib.request.Request(url+'/__reset',method='POST')).close()
    browser=engine.launch()
    context=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1)
    page=context.new_page(); errors=[]
    screenshots=Path('data/proof');screenshots.mkdir(parents=True,exist_ok=True)
    page.on('pageerror',lambda error: errors.append(str(error)))
    try:
        page.goto(url)
        page.get_by_role('button',name=re.compile('Sample Strength')).click()
        page.get_by_role('button',name=re.compile(r'^Start Day \d+$')).wait_for()
        # P6: five taps add an exercise for today (Edit day, Add, pick, continue, add).
        page.get_by_role('button',name='Edit day',exact=True).click()
        page.screenshot(path=str(screenshots/f'{engine.name}-reach.png'))
        page.get_by_role('button',name='+ Add exercise',exact=True).click()
        page.get_by_role('button',name=re.compile('^Decline Press')).click()
        page.screenshot(path=str(screenshots/f'{engine.name}-add.png'))
        page.get_by_role('button',name='Add 1 exercise',exact=True).click()
        page.get_by_role('button',name='Decrease sets',exact=True).click()
        page.screenshot(path=str(screenshots/f'{engine.name}-sets.png'))
        page.get_by_role('button',name='Add Decline Press',exact=True).click()
        expect(page.get_by_role('button',name='Change Decline Press',exact=True)).to_be_visible()
        page.keyboard.press('Escape')
        page.get_by_role('button',name='Resume workout',exact=True).wait_for()
        page.get_by_role('button',name='Resume workout',exact=True).click()
        expand_exercises(page)
        page.get_by_role('button',name=re.compile('^Log set')).first.wait_for()
        weight=page.get_by_label('Set 1 weight in kg').first
        expect(weight).to_have_value('')
        source=next(row for row in rows(page,'session') if row['id']=='past-1')['local_date']
        source_label=page.evaluate("date=>{const d=new Date(date+'T12:00:00Z');return d.toLocaleDateString('en-US',{weekday:'short',timeZone:'UTC'})+' '+d.getUTCDate()+' '+d.toLocaleDateString('en-US',{month:'short',timeZone:'UTC'});}",source)
        expect(page.locator('.exercise .subtitle').first).to_contain_text('Last time at 4 to 6 · '+source_label)
        weight.fill('102.5')
        assert weight.get_attribute('inputmode')=='decimal', 'Weight must open the number keyboard'
        weight.click();page.screenshot(path=str(screenshots/f'{engine.name}-pad.png'))
        weight.fill('0,75')
        page.get_by_label('Set 1 reps',exact=True).first.fill('6')
        if engine.name=='chromium':context.new_cdp_session(page).send('Emulation.setCPUThrottlingRate',{'rate':4})
        page.wait_for_function('navigator.serviceWorker.controller !== null')
        context.set_offline(True)
        page.get_by_role('button',name=re.compile('^Log set')).first.dblclick(delay=20)
        page.wait_for_timeout(200)
        first_logged=[r for r in rows(page,'set') if r.get('done_at') and not r['id'].startswith('past-')]
        assert len(first_logged)==1, {'count':len(first_logged),'alerts':page.get_by_role('alert').all_text_contents(),'errors':errors}
        assert first_logged[0]['weight']==0.75 and first_logged[0]['grams']==750, 'A comma decimal must save as 0.75 kg'
        expect(page.locator('.logger-save-status')).to_have_text(f"Saved here · {len(rows(page,'outbox'))} waiting")
        context.set_offline(False)
        page.request.post(url+'/__stop')
        started=perf_counter()
        page.reload(wait_until='domcontentloaded')
        page.get_by_role('timer').wait_for()
        page.screenshot(path=str(screenshots/f'{engine.name}-resting.png'))
        opened_ms=(perf_counter()-started)*1000
        if engine.name=='chromium':assert opened_ms<1000,opened_ms
        expect(page.get_by_text('Behind last time',exact=True)).to_be_visible()
        before_rest=page.get_by_role('timer').inner_text()
        page.get_by_role('button',name='+15 s',exact=True).click()
        after_rest=page.get_by_role('timer').inner_text()
        seconds=lambda value:int(value.split(':')[0])*60+int(value.split(':')[1])
        assert 14<=seconds(after_rest)-seconds(before_rest)<=15
        context.set_offline(True)
        assert len([r for r in rows(page,'set') if r.get('done_at') and not r['id'].startswith('past-')])==1
        page.evaluate('window.realNow=Date.now;Date.now=()=>window.realNow()+180000')
        expand_exercises(page)
        page.get_by_role('button',name=re.compile('^Log set')).first.wait_for()
        page.screenshot(path=str(screenshots/f'{engine.name}-lifting.png'))
        page.emulate_media(color_scheme='dark');page.screenshot(path=str(screenshots/f'{engine.name}-lifting-dark.png'));page.emulate_media(color_scheme='light')
        finish_workout(page,engine,screenshots)
        logged=[r for r in rows(page,'set') if r.get('done_at') and not r['id'].startswith('past-')]
        assert len(logged)==6
        context.set_offline(False)
        page.evaluate('Date.now=window.realNow')
        deadline=monotonic()+15
        while True:
            healthy=page.evaluate("async()=>{try{return(await fetch('/api/health')).ok}catch{return false}}")
            if healthy:break
            assert monotonic()<deadline,'Fixture server did not restart'
            page.wait_for_timeout(50)
        page.get_by_role('button',name='Session',exact=True).click()
        page.get_by_role('button',name='Check now',exact=True).click()
        page.get_by_role('button',name='Close',exact=True).click()
        page.get_by_role('button',name='Done',exact=True).click()
        page.locator('header.app-top button').first.click()
        deadline=monotonic()+15
        while rows(page,'outbox'):
            assert monotonic()<deadline,'The outbox did not drain after reconnect'
            page.wait_for_timeout(50)
        expect(page.locator('header.app-top .status')).to_have_text('Synced · 30 days verified')
        server=page.request.get(url+'/api/changes?since=0').json()['rows']
        saved=[item['row'] for item in server if item['table']=='set' and item['row'].get('done_at') and not item['row']['id'].startswith('past-')]
        assert len(saved)==6, {'engine':engine.name,'remote':len(saved),'local':len(logged),'pending':len(rows(page,'outbox'))}
        assert len({row['id'] for row in saved})==6
        page.get_by_role('button',name='Session',exact=True).click()
        page.get_by_role('button',name='Check now',exact=True).click()
        page.get_by_text('Sets in this date range matched the server at the last check.',exact=True).wait_for()
        toggle=page.get_by_role('switch').first
        assert toggle.bounding_box()['width']==52 and toggle.bounding_box()['height']==32
        assert not page.get_by_role('button',name='Close',exact=True).evaluate("node=>node.matches(':focus-visible')")
        expect(page.get_by_text(re.compile('^Last check:'))).to_contain_text(re.compile(r'Last check: \w{3} \d{1,2}, \d{4}'))
        expect(page.get_by_text(re.compile('^Set dates:'))).to_contain_text('Older sets and workout details are not checked.')
        page.screenshot(path=str(screenshots/f'{engine.name}-session.png'))
        page.get_by_role('button',name='Close',exact=True).click()
        capture_views(page,engine,screenshots)
        page.get_by_role('button',name='Session',exact=True).click()
        assert page.request.post(url+'/__plant').json()['planted']
        page.get_by_role('button',name='Check now',exact=True).click()
        page.get_by_text('The set counts or contents differed at the last check.',exact=True).wait_for()
        page.get_by_role('button',name='Close',exact=True).click()
        page.get_by_role('button',name='Saved sets differ · Review Session',exact=True).wait_for()
        event_rows=[row for row in rows(page,'event') if row['kind']=='logged']
        assert len(event_rows)==7
        event_rows.sort(key=lambda row:row['time'])
        taps=[row['detail']['taps'] for row in event_rows]
        # The last re-log follows one tap that the double-tap guard ignored.
        assert taps[0]>=1 and taps[1:6]==[1,1,1,1,1] and taps[6] in (1,2), taps
        assert all(row['detail']['seconds']<0.1 for row in event_rows[1:6]), 'Rest taps must not start the next set timer'
        saved_ms=sorted(row['detail']['saveMs'] for row in event_rows)
        if engine.name=='chromium':assert saved_ms[-1]<50,saved_ms
        assert not errors,errors
        print(f'PASS {engine.name}: 5-tap add, offline double tap, restart, 3-minute rest, six unique synced sets, views, changed-field mismatch; offline open {opened_ms:.0f}ms, max save {saved_ms[-1]:.1f}ms')
    finally:
        context.close();browser.close()


def finish_workout(page,engine,screenshots):
    for i in range(5):
        weight=page.locator('.set-row:not(.done) input[id^="weight-"]').first
        if weight.count() and weight.input_value()=='':weight.fill('50')
        page.locator('.set-row:not(.done) input[id^="reps-"]').first.fill('6')
        page.get_by_role('button',name=re.compile('^Log set')).first.click()
        if i<4:
            rest=page.get_by_role('button',name='Skip',exact=True)
            rest.wait_for()
            if i==0:
                chip=page.get_by_role('button',name='1',exact=True)
                chip.click();expect(chip).to_have_attribute('aria-pressed','true')
                chip.click();expect(chip).to_have_attribute('aria-pressed','false')
            rest.click();page.wait_for_timeout(150)
    page.get_by_role('heading',name='Workout complete',exact=True).wait_for()
    effort=page.get_by_role('group',name='Session effort').get_by_role('button',name=re.compile('^7(?: selected)?$'))
    effort.click();expect(effort).to_have_attribute('aria-pressed','true')
    assert effort.bounding_box()['height']>=56
    page.get_by_role('button',name='Done',exact=True).scroll_into_view_if_needed()
    back=page.get_by_role('button',name='Done',exact=True).bounding_box()
    assert back['y']+back['height']<=844, 'Completion controls must fit the phone screen'
    page.screenshot(path=str(screenshots/f'{engine.name}-done.png'))
    page.wait_for_timeout(1100)
    page.get_by_role('button',name='See sets',exact=True).click()
    expand_exercises(page)
    page.get_by_role('button',name=re.compile('^Undo set')).last.click()
    page.get_by_role('button',name=re.compile('^Log set')).first.click()
    assert page.get_by_role('heading',name='Workout complete',exact=True).count()==0, 'A second tap within one second must not log again'
    page.wait_for_timeout(1100)
    page.get_by_role('button',name=re.compile('^Log set')).first.click()
    page.get_by_role('heading',name='Workout complete',exact=True).wait_for()
    completions=[r for r in rows(page,'run_event') if r.get('kind')=='done' and not r.get('deleted_at')]
    assert len(completions)==1, 'Undo and re-log must restore the completed program day'


def verify_session_start(engine,url):
    urllib.request.urlopen(urllib.request.Request(url+'/__reset',method='POST')).close()
    browser=engine.launch();context=browser.new_context(viewport={'width':390,'height':844})
    try:
        context.add_init_script('window.realNow=Date.now;Date.now=()=>window.realNow()-2*86400000')
        page=context.new_page();page.goto(url)
        page.get_by_role('button',name=re.compile('Sample Strength')).click()
        page.get_by_role('button',name='Edit day',exact=True).click()
        page.get_by_role('button',name='+ Add exercise',exact=True).click()
        page.get_by_role('button',name=re.compile('^Decline Press')).click()
        page.get_by_role('button',name='Add 1 exercise',exact=True).click()
        page.get_by_role('button',name='Add Decline Press',exact=True).click()
        expect(page.get_by_role('button',name='Change Decline Press',exact=True)).to_be_visible()
        page.keyboard.press('Escape')
        page.get_by_role('button',name='Resume workout',exact=True).click()
        expand_exercises(page)
        page.get_by_role('button',name=re.compile('^Log set')).first.wait_for()
        opened=[s for s in rows(page,'session') if s.get('status')=='open'][0]
        today=page.evaluate("new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date())")
        assert opened['local_date']!=today
        page.evaluate('Date.now=window.realNow')
        page.get_by_role('button',name=re.compile('^Weight in kg')).first.click()
        page.get_by_label('Set 1 weight in lb').first.fill('50')
        page.get_by_label('Set 1 reps',exact=True).first.fill('6')
        page.get_by_role('button',name=re.compile('^Log set')).first.click()
        page.get_by_role('button',name='Skip',exact=True).click()
        expect(page.get_by_label('Set 2 weight in lb').first).to_have_value('')
        current=next(s for s in rows(page,'session') if s['id']==opened['id'])
        assert current['local_date']==today
        slot_ids={s['id'] for s in rows(page,'session_slot') if s['session_id']==current['id']}
        sets=[s for s in rows(page,'set') if s['session_slot_id'] in slot_ids]
        assert all(s['local_date']==today for s in sets)
        logged=next(s for s in sets if s.get('done_at'))
        assert logged['unit']=='lb' and logged['weight']==50 and logged['grams']==22680
        print(f'PASS {engine.name}: pre-opened workout uses training date; next set keeps 50 lb')
    finally:
        context.close();browser.close()


def verify_overnight_resume(engine,url):
    urllib.request.urlopen(urllib.request.Request(url+'/__reset',method='POST')).close()
    browser=engine.launch();context=browser.new_context(viewport={'width':390,'height':844})
    try:
        context.add_init_script("""window.fixtureRealNow=Date.now;
            if(!sessionStorage.getItem('fixture-offset'))sessionStorage.setItem('fixture-offset',String(Date.parse('2026-10-27T04:50:00Z')-Date.now()));
            Date.now=()=>window.fixtureRealNow()+Number(sessionStorage.getItem('fixture-offset'));""")
        page=context.new_page();page.goto(url)
        page.get_by_role('button',name=re.compile('Sample Strength')).click()
        page.get_by_role('button',name='Add individual workout',exact=True).click()
        sheet=page.get_by_role('dialog')
        sheet.locator('.card.list .list-row').first.click()
        sheet.get_by_role('button',name='Add workout',exact=True).click()
        bench=page.get_by_role('article',name='Bench Press',exact=True)
        bench.get_by_role('button',name='Expand Bench Press',exact=True).click()
        bench.get_by_label('Set 1 weight in kg',exact=True).fill('50')
        bench.get_by_label('Set 1 reps',exact=True).fill('6')
        bench.get_by_role('button',name='Log set 1',exact=True).click()
        expect(bench.get_by_role('button',name='Undo set 1',exact=True)).to_be_visible()
        original=next(row for row in rows(page,'session') if row.get('source')=='app' and row.get('program_day_id') is None)
        page.get_by_role('button',name='Home',exact=True).click()
        page.evaluate("sessionStorage.setItem('fixture-offset',String(Number(sessionStorage.getItem('fixture-offset'))+86400000))")
        page.reload()
        expect(page.locator('.hero')).to_contain_text('Extra workout')
        page.get_by_role('button',name='Resume workout',exact=True).click()
        bench.get_by_role('button',name='Expand Bench Press',exact=True).click()
        bench.get_by_role('button',name='Undo set 1',exact=True).click()
        bench.get_by_label('Set 1 weight in kg',exact=True).fill('50')
        bench.get_by_label('Set 1 reps',exact=True).fill('6')
        page.wait_for_timeout(1100)
        bench.get_by_role('button',name='Log set 1',exact=True).click()
        expect(bench.get_by_role('button',name='Undo set 1',exact=True)).to_be_visible()
        saved=next(row for row in rows(page,'session') if row['id']==original['id'])
        assert saved['started_at']==original['started_at'] and saved['local_date']==original['local_date']=='2026-10-26'
        own_slots={row['id'] for row in rows(page,'session_slot') if row['session_id']==original['id']}
        assert all(row['local_date']=='2026-10-26' for row in rows(page,'set') if row['session_slot_id'] in own_slots)
        print(f'PASS {engine.name}: extra workout resumes after midnight; Undo and re-log keep its start and training date')
    finally:context.close();browser.close()


def verify_schedule(engine,url):
    urllib.request.urlopen(urllib.request.Request(url+'/__reset',method='POST')).close()
    browser=engine.launch();context=browser.new_context(viewport={'width':390,'height':844})
    try:
        page=context.new_page();page.goto(url)
        page.get_by_role('button',name=re.compile('Sample Strength')).click()
        page.get_by_role('navigation',name='Main').get_by_role('button',name='Program',exact=True).click()
        page.get_by_role('button',name='Options',exact=True).click()
        for day in ['Tue','Wed','Fri','Sat']:page.get_by_role('button',name=day,exact=True).click()
        page.get_by_role('button',name='Save schedule from today',exact=True).click()
        page.get_by_role('button',name='Options',exact=True).click()
        expect(page.get_by_role('button',name='Tue',exact=True)).to_have_attribute('aria-pressed','false')
        expect(page.get_by_role('button',name='Thu',exact=True)).to_have_attribute('aria-pressed','true')
        before=[r for r in rows(page,'run_setting') if r['weekly_target']>0][-1]
        page.get_by_role('button',name='Save schedule from today',exact=True).click()
        after=[r for r in rows(page,'run_setting') if r['weekly_target']>0][-1]
        assert before['weekdays']==after['weekdays']==[1,4]
        assert before['days_per_week']==after['days_per_week']==after['weekly_target']==2
        page.evaluate('''async()=>{
            const db=await new Promise(resolve=>{const r=indexedDB.open('workout-tracker');r.onsuccess=()=>resolve(r.result)});
            const tx=db.transaction(['setting','outbox'],'readwrite');
            const row={id:'refused-ui',rev:1,device_id:'fixture',updated_at:1,deleted_at:null,value:'keep',old_client_field:true};
            tx.objectStore('setting').put(row);tx.objectStore('outbox').put({id:'refused-ui-op',table:'setting',row,row_key:'setting:refused-ui'});
            await new Promise(resolve=>tx.oncomplete=resolve);db.close();
        }''')
        message='A change was rejected. Export this device before resetting it.'
        page.reload();expect(page.locator('.sync-error')).to_have_text(message)
        page.locator('.sync-error').click()
        expect(page.get_by_role('dialog')).to_contain_text(message)
        page.screenshot(path=f'data/proof/{engine.name}-sync-error.png')
        print(f'PASS {engine.name}: Program options retain current weekdays and target with no edits')
    finally:context.close();browser.close()

def verify_extra_sets(engine,url):
    urllib.request.urlopen(urllib.request.Request(url+'/__reset',method='POST')).close()
    browser=engine.launch();context=browser.new_context(viewport={'width':390,'height':844},timezone_id='America/Chicago')
    try:
        page=context.new_page();page.goto(url)
        page.get_by_role('button',name=re.compile('Sample Strength')).click()
        page.get_by_role('button',name=re.compile(r'^Start Day \d+$')).wait_for()
        deadline=monotonic()+15
        while not all(row.get('seq') is not None for row in rows(page,'run')):
            assert monotonic()<deadline,'The sample run did not finish syncing before the baseline'
            page.wait_for_timeout(50)
        before={table:rows(page,table) for table in ['program','program_day','slot','slot_set','run']}
        page.get_by_role('navigation',name='Main').get_by_role('button',name='Calendar',exact=True).click()
        page.locator('.calendar-day.today').click()
        page.get_by_role('button',name='Add workout',exact=True).click()
        page.get_by_role('button',name='Extra sets only',exact=True).click()
        page.screenshot(path=f'data/proof/{engine.name}-extra-search.png')
        page.get_by_role('button',name=re.compile('^Decline Press')).click()
        page.screenshot(path=f'data/proof/{engine.name}-extra-sets.png')
        page.get_by_role('button',name='Next',exact=True).click()
        page.screenshot(path=f'data/proof/{engine.name}-extra-reach.png')
        assert page.get_by_role('button',name=re.compile('every week|from now on')).count()==0
        page.get_by_role('button',name='Today only',exact=True).click()
        expand_exercises(page)
        page.get_by_role('button',name=re.compile('^Log set')).first.wait_for()
        page.screenshot(path=f'data/proof/{engine.name}-extra-logging.png')
        extra=next(s for s in rows(page,'session') if s.get('status')=='open')
        assert extra['program_day_id'] is None and extra['run_id']==before['run'][0]['id']
        for i in range(2):
            weight=page.locator('.set-row:not(.done) input[id^="weight-"]').first
            if weight.count() and weight.input_value()=='':weight.fill('50')
            page.locator('.set-row:not(.done) input[id^="reps-"]').first.fill('6')
            page.get_by_role('button',name=re.compile('^Log set')).first.click()
            if i==0:page.get_by_role('button',name='Skip',exact=True).click()
        page.get_by_role('heading',name='Workout complete',exact=True).wait_for()
        assert not any(r['kind']=='done' for r in rows(page,'run_event'))
        after={table:rows(page,table) for table in before}
        assert after==before,{table:{'before_count':len(before[table]),'after_count':len(after[table]),'changed':[row for row in after[table] if row not in before[table]]} for table in before if before[table]!=after[table]}
        page.get_by_role('button',name='Done',exact=True).click()
        page.get_by_role('navigation',name='Main').get_by_role('button',name='Calendar',exact=True).click()
        assert 'added' in page.locator('.calendar-day.today').get_attribute('class')
        page.screenshot(path=f'data/proof/{engine.name}-extra-calendar.png')
        page.locator('.calendar-day.today').click()
        assert page.get_by_role('button',name='Skip this day',exact=True).count()==0
        assert page.get_by_role('button',name='Shift the remaining workouts',exact=True).count()==0
        page.screenshot(path=f'data/proof/{engine.name}-calendar-added-actions.png')
        print(f'PASS {engine.name}: extra sets open today, preserve templates and run position, finish without done event')
    finally:context.close();browser.close()

def verify_reference_sources(engine,url):
    for mode in ['week','other_range']:
        urllib.request.urlopen(urllib.request.Request(url+'/__reset',method='POST')).close()
        browser=engine.launch();context=browser.new_context(viewport={'width':390,'height':844})
        try:
            page=context.new_page();page.goto(url)
            page.get_by_role('button',name=re.compile('Sample Strength')).click()
            run=rows(page,'run')[0]['id']
            page.evaluate('''async({mode,run})=>{
                const db=await new Promise(resolve=>{const r=indexedDB.open('workout-tracker');r.onsuccess=()=>resolve(r.result)});
                const tx=db.transaction(['session','program_day','set'],'readwrite');
                if(mode==='week'){
                    const session=tx.objectStore('session').get('past-1');session.onsuccess=()=>tx.objectStore('session').put({...session.result,run_id:run,program_day_id:'reference-day'});
                    tx.objectStore('program_day').put({id:'reference-day',program_id:'sample',position:99,week:3,day:1});
                }else{
                    const request=tx.objectStore('set').getAll();request.onsuccess=()=>{for(const row of request.result)tx.objectStore('set').put({...row,target_reps_min:8,target_reps_max:10});};
                }
                await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=reject});db.close();
            }''',{'mode':mode,'run':run})
            page.reload();page.get_by_role('button',name=re.compile(r'^Start Day \d+$')).click()
            subtitle=page.locator('.exercise .subtitle').first
            if mode=='week':expect(subtitle).to_contain_text('Last time at 4 to 6 · Week 3')
            else:
                expect(subtitle).to_contain_text('First time at 4 to 6')
                page.get_by_role('button',name='Exercise menu for Bench Press',exact=True).click()
                expect(page.locator('.target-reason')).to_have_text('Suggested target: 100 kg × 6. Uses your last result from a different rep range.')
            page.screenshot(path=f'data/proof/{engine.name}-reference-{mode}.png')
        finally:context.close();browser.close()
    print(f'PASS {engine.name}: last-time source week and saved other-range target explanation')

def verify_current_sets(engine,url):
    urllib.request.urlopen(urllib.request.Request(url+'/__reset',method='POST')).close()
    browser=engine.launch();context=browser.new_context(viewport={'width':390,'height':844})
    try:
        page=context.new_page();page.goto(url)
        page.get_by_role('button',name=re.compile('Sample Strength')).click()
        page.get_by_role('button',name='Edit day',exact=True).click()
        close=page.get_by_role('button',name='Close',exact=True)
        assert not close.evaluate("node=>node.matches(':focus-visible')")
        page.keyboard.press('Alt+Tab' if engine.name=='webkit' else 'Tab');expect(close).to_be_focused()
        assert close.evaluate("node=>node.matches(':focus-visible')")
        page.get_by_role('button',name='Change Bench Press',exact=True).click()
        page.screenshot(path=f'data/proof/{engine.name}-exercise-menu.png')
        page.get_by_role('button',name='Change sets',exact=True).click()
        page.get_by_role('button',name='Increase sets',exact=True).click()
        for i in range(4):page.get_by_role('button',name='Increase maximum reps',exact=True).click()
        for i in range(4):page.get_by_role('button',name='Increase minimum reps',exact=True).click()
        page.get_by_role('button',name='Save sets',exact=True).click()
        page.get_by_role('button',name='Change Bench Press',exact=True).click()
        page.get_by_role('button',name='Change sets',exact=True).click()
        for label,value in [('Sets','3'),('Minimum reps','8'),('Maximum reps','10')]:
            expect(page.get_by_role('group',name=label,exact=True).locator('output')).to_have_text(value)
        page.screenshot(path=f'data/proof/{engine.name}-current-sets.png')
        page.keyboard.press('Escape');expect(page.get_by_role('dialog')).not_to_be_visible()
        page.get_by_role('navigation',name='Main').get_by_role('button',name='Calendar',exact=True).click()
        page.locator('.calendar-day.today').click()
        page.screenshot(path=f'data/proof/{engine.name}-calendar-planned-actions.png')
        expect(page.get_by_role('button',name='Workout · Resume',exact=True)).to_be_visible()
        page.keyboard.press('Escape')
        print(f'PASS {engine.name}: current set values, steppers, first exercise target, sheet keyboard focus and calendar actions')
    finally:context.close();browser.close()

def verify_add_set_and_finish(engine,url):
    urllib.request.urlopen(urllib.request.Request(url+'/__reset',method='POST')).close()
    browser=engine.launch();context=browser.new_context(viewport={'width':390,'height':844})
    try:
        page=context.new_page();page.goto(url)
        page.get_by_role('button',name=re.compile('Sample Strength')).click()
        page.get_by_role('button',name=re.compile(r'^Start Day \d+$')).click()
        bench=page.get_by_role('article',name='Bench Press')
        expand_exercises(page)
        expect(bench.get_by_label('Set 1 weight in kg')).to_have_value('')
        bench.get_by_role('button',name='+ Add set',exact=True).click()
        expect(bench.get_by_role('button',name=re.compile('^Log set'))).to_have_count(3)
        expect(bench.get_by_label('Set 3 weight in kg')).to_have_value('')
        assert_type_scale(page,'Logger')
        bench.get_by_label('Set 3 weight in kg').fill('102.5')
        bench.get_by_label('Set 3 reps',exact=True).fill('6')
        bench.get_by_role('button',name='Log set 3',exact=True).click()
        page.once('dialog',lambda dialog:dialog.accept())
        page.get_by_role('button',name='Finish workout',exact=True).click()
        page.get_by_role('dialog',name='Finish workout?',exact=True).get_by_role('button',name='Finish workout',exact=True).click()
        page.get_by_role('button',name='Done',exact=True).click()
        page.get_by_role('navigation',name='Main').wait_for()
        session=max((s for s in rows(page,'session') if s.get('source')=='app'),key=lambda s:s['started_at'])
        assert session['status']!='open',session['status']
        bar=page.get_by_role('status').filter(has_text='Finished early')
        expect(bar).to_be_visible();assert_type_scale(page,'Undo bar')
        bar.get_by_role('button',name='Undo',exact=True).click()
        page.get_by_role('button',name='Resume workout',exact=True).wait_for()
        expect(page.locator('.hero')).to_contain_text('In progress');expect(page.locator('.hero')).to_contain_text('last set');expect(page.locator('.hero')).to_contain_text('sets logged')
        assert [s for s in rows(page,'session') if s['id']==session['id']][0]['status']=='open'
        # A save after the offer turns Undo off; the bar follows into an open sheet.
        page.get_by_role('button',name='Resume workout',exact=True).click()
        page.get_by_role('button',name='Finish workout',exact=True).click()
        page.get_by_role('dialog',name='Finish workout?',exact=True).get_by_role('button',name='Finish workout',exact=True).click()
        page.get_by_role('button',name='Done',exact=True).click()
        page.get_by_role('navigation',name='Main').wait_for()
        page.get_by_role('button',name='Session',exact=True).click()
        sheet=page.get_by_role('dialog');bar=sheet.get_by_role('status').filter(has_text='Finished early')
        expect(bar).to_be_visible()
        sheet.get_by_label(re.compile('^Bodyweight in kg')).fill('80');sheet.get_by_label(re.compile('^Bodyweight in kg')).blur()
        page.wait_for_timeout(200);bar.get_by_role('button',name='Undo',exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('Undo is off')
        assert [s for s in rows(page,'session') if s['id']==session['id']][0]['status']!='open'
        print(f'PASS {engine.name}: Undo refuses after a later save and shows inside an open sheet')
        print(f'PASS {engine.name}: add set starts blank; finish early closes the workout; Undo reopens it and Home offers Resume')
    finally:context.close();browser.close()


def verify_next_set_remove(engine,url):
    urllib.request.urlopen(urllib.request.Request(url+'/__reset',method='POST')).close()
    browser=engine.launch();context=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1)
    try:
        page=context.new_page();page.goto(url)
        page.get_by_role('button',name=re.compile('Sample Strength')).click()
        page.get_by_role('button',name=re.compile(r'^Start Day \d+$')).click()
        bench=page.get_by_role('article',name='Bench Press',exact=True)
        expand_exercises(page)
        weight=bench.get_by_label('Set 1 weight in kg',exact=True)
        expect(weight).to_have_value('')
        weight.fill('102.5')
        bench.get_by_label('Set 1 reps',exact=True).fill('6')
        bench.get_by_role('button',name='Log set 1',exact=True).click()
        next_weight=bench.get_by_label('Set 2 weight in kg',exact=True);expect(next_weight).to_have_value('')
        next_weight.fill('95.5');bench.get_by_label('Set 2 reps',exact=True).fill('5')
        bench.get_by_role('button',name='+ Add set',exact=True).click()
        expect(bench.get_by_label('Set 3 weight in kg',exact=True)).to_have_value('')
        page.reload();expect(page.get_by_role('article',name='Bench Press',exact=True)).to_be_visible()
        bench=page.get_by_role('article',name='Bench Press',exact=True)
        expand_exercises(page)
        next_weight=bench.get_by_label('Set 2 weight in kg',exact=True)
        expect(next_weight).to_have_value('95.5');expect(bench.get_by_label('Set 2 reps',exact=True)).to_have_value('5')
        page.set_viewport_size({'width':1440,'height':900})
        page.screenshot(path='data/proof/desktop-next-set-workout.png')
        page.set_viewport_size({'width':390,'height':844})
        before={table:rows(page,table) for table in ['slot','slot_set','session','session_slot','set']}
        session_id=next(row['id'] for row in before['session'] if row.get('status')=='open')
        slot_id=next(row['id'] for row in before['session_slot'] if row.get('session_id')==session_id and row.get('name')=='Bench Press')
        set_id=next(row['id'] for row in before['set'] if row.get('session_slot_id')==slot_id and row.get('done_at'))
        button=bench.get_by_role('button',name='Exercise menu for Bench Press',exact=True).bounding_box()
        page.mouse.move(button['x']+button['width']/2,button['y']+button['height']/2);page.mouse.down();page.mouse.move(button['x']-70,button['y']+button['height']/2,steps=3);page.mouse.up()
        expect(page.get_by_role('button',name='Remove',exact=True)).to_have_count(0)
        bounds=bench.locator('header').bounding_box();x=bounds['x']+bounds['width']/2;y=bounds['y']+bounds['height']/2
        page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+80,y,steps=4);page.mouse.up()
        remove=page.get_by_role('button',name='Remove',exact=True);expect(remove).to_be_visible()
        page.wait_for_function("() => getComputedStyle(document.querySelector('.exercise-swipe.reveal-left > article')).transform === 'matrix(1, 0, 0, 1, 88, 0)'")
        page.evaluate('() => window.getSelection()?.removeAllRanges()')
        if engine.name=='chromium':page.screenshot(path='data/proof/phone-next-set-swipe-remove.png')
        remove.click()
        confirm=page.get_by_role('dialog',name='Remove exercise?',exact=True)
        expect(confirm).to_contain_text('1 logged set')
        confirm.get_by_role('button',name='Remove exercise',exact=True).click()
        undo=page.get_by_role('status').filter(has_text='Exercise removed').get_by_role('button',name='Undo',exact=True)
        expect(undo).to_be_visible()
        deleted=rows(page,'set');assert next(row for row in deleted if row['id']==set_id).get('deleted_at')
        history_slots={row['id'] for row in before['session_slot'] if row.get('session_id')!=session_id}
        assert all(not row.get('deleted_at') for row in deleted if row.get('session_slot_id') in history_slots),'Past workout sets must remain live'
        undo.click()
        restored=page.get_by_role('article',name='Bench Press',exact=True);expect(restored).to_be_visible()
        expand_exercises(page)
        expect(restored.get_by_label('Set 2 weight in kg',exact=True)).to_have_value('95.5')
        expect(restored.get_by_label('Set 2 reps',exact=True)).to_have_value('5')
        expect(restored.get_by_label('Set 3 weight in kg',exact=True)).to_have_value('')
        page.reload();expect(page.get_by_role('article',name='Bench Press',exact=True)).to_be_visible()
        restored=page.get_by_role('article',name='Bench Press',exact=True)
        expand_exercises(page)
        expect(restored.get_by_label('Set 2 weight in kg',exact=True)).to_have_value('95.5')
        expect(restored.get_by_label('Set 2 reps',exact=True)).to_have_value('5')
        after={table:rows(page,table) for table in ['slot','slot_set']}
        assert after=={table:before[table] for table in after},'Removing today must leave the program unchanged'
        restored.get_by_role('button',name='Exercise menu for Bench Press',exact=True).click()
        expect(page.get_by_role('dialog').get_by_role('button',name='Remove exercise',exact=True)).to_be_visible()
        page.keyboard.press('Escape')
        assert next(row for row in rows(page,'set') if row['id']==set_id).get('done_at'),'Undo must retain the logged set'
        bounds=restored.locator('header').bounding_box();x=bounds['x']+bounds['width']/2;y=bounds['y']+bounds['height']/2
        page.mouse.move(x,y);page.mouse.down();page.mouse.move(x-80,y,steps=4);page.mouse.up()
        expect(page.get_by_role('button',name='Remove',exact=True)).to_be_visible()
        wrapper=restored.locator('xpath=..')
        wrapper.dispatch_event('pointercancel',{'pointerId':1,'pointerType':'touch'})
        expect(page.get_by_role('button',name='Remove',exact=True)).to_have_count(0)
        print(f'PASS {engine.name}: blank initial/add-set weights, persisted draft, button drag guard, both swipe directions, logged-set confirmation, Undo and menu Remove')
    finally:context.close();browser.close()


def verify_program_edit(engine,url):
    urllib.request.urlopen(urllib.request.Request(url+'/__reset',method='POST')).close()
    browser=engine.launch();context=browser.new_context(viewport={'width':390,'height':844})
    try:
        page=context.new_page();page.goto(url)
        page.get_by_role('button',name=re.compile('Sample Strength')).click()
        sessions=len(rows(page,'session'))
        page.get_by_role('navigation',name='Main').get_by_role('button',name='Program',exact=True).click()
        page.locator('.day-item .pill').first.click()
        expect(page.get_by_role('radio',name='This week only',exact=True)).to_have_attribute('aria-checked','true')
        page.get_by_role('radio',name='Every week',exact=True).click()
        assert_type_scale(page,'Edit day')
        page.get_by_role('button',name='+ Add exercise',exact=True).click()
        page.get_by_role('radiogroup',name='Muscle').get_by_role('radio',name='Chest',exact=True).click()
        expect(page.get_by_role('dialog').get_by_role('button',name=re.compile('Barbell Row'))).to_have_count(0)
        page.get_by_role('button',name=re.compile('^Decline Press')).click()
        page.get_by_role('button',name='Add 1 exercise',exact=True).click()
        page.get_by_role('button',name='Add Decline Press',exact=True).click()
        expect(page.get_by_role('button',name='Change Decline Press',exact=True)).to_be_visible()
        days={d['id']:d for d in rows(page,'program_day')}
        added=[s for s in rows(page,'slot') if s['exercise_id']=='decline' and not s.get('deleted_at')]
        assert added and all(days[s['program_day_id']]['day']==1 for s in added),added
        assert len(added)==sum(1 for d in days.values() if d['day']==1 and d['program_id']==days[added[0]['program_day_id']]['program_id'])
        assert len(rows(page,'session'))==sessions,'Program edits must not start a workout'
        page.keyboard.press('Escape')
        page.locator('.day-row').nth(1).click()
        expect(page.locator('.hero-head')).to_contain_text('Week 1 · Day 2')
        expect(page.get_by_role('button',name=re.compile(r'^Start Day \d+$'))).to_be_visible()
        print(f'PASS {engine.name}: program tab adds an exercise to every week without starting a workout, and tapping a day opens it')
    finally:context.close();browser.close()


if __name__ == '__main__':
    with sync_playwright() as p:
        for engine in [p.chromium,p.webkit]:
            verify_overnight_resume(engine,sys.argv[1])
            verify_schedule(engine,sys.argv[1])
            verify_extra_sets(engine,sys.argv[1])
            verify_reference_sources(engine,sys.argv[1])
            verify_current_sets(engine,sys.argv[1])
            verify_next_set_remove(engine,sys.argv[1])
            verify_add_set_and_finish(engine,sys.argv[1])
            verify_program_edit(engine,sys.argv[1])
            run(engine,sys.argv[1])
            verify_session_start(engine,sys.argv[1])

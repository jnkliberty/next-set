"""Integrated journeys against the invented browser fixture, never a live database."""
import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

OUT = Path('data/proof/journeys')
OUT.mkdir(parents=True, exist_ok=True)
AUDITS = []
MATRICES = {
    'deutan': '0.367322 0.860646 -0.227968 0 0 0.280085 0.672501 0.047413 0 0 -0.011820 0.042940 0.968881 0 0 0 0 0 1 0',
    'protan': '0.152286 1.052583 -0.204868 0 0 0.114503 0.786281 0.099216 0 0 -0.003882 -0.048116 1.051998 0 0 0 0 0 1 0',
}


def rows(page, table):
    return page.evaluate('''async table=>{
      const r=indexedDB.open('workout-tracker');const db=await new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
      const q=db.transaction(table).objectStore(table).getAll();const rows=await new Promise((resolve,reject)=>{q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});db.close();return rows;
    }''', table)


def live_rows(page, table):
    return [r for r in rows(page, table) if not r.get('deleted_at')]


def snapshot(page, tables):
    return {table: live_rows(page, table) for table in tables}


def capture(page, engine, name):
    for theme in ['light', 'dark']:
        page.emulate_media(color_scheme=theme)
        for width in [320, 390, 900, 1440]:
            page.set_viewport_size({'width': width, 'height': 844})
            page.screenshot(path=str(OUT / f'{engine}-{name}-{theme}-{width}.png'), full_page=True)
            result = page.evaluate('''()=>{
              const root=document.querySelector('dialog[open]')??document.querySelector('.app');
              const visible=e=>e.getClientRects().length&&e.getBoundingClientRect().right>0&&getComputedStyle(e).visibility!=='hidden';
              const controls=[...root.querySelectorAll('button,input,select,textarea,a[href]')].filter(visible);
              const small=controls.map(e=>{const box=(e.matches('input[type=radio],input[type=checkbox]')?e.closest('label')??e:e).getBoundingClientRect();return {label:e.getAttribute('aria-label')??e.textContent??e.tagName,width:box.width,height:box.height};}).filter(e=>e.width<43.5||e.height<43.5);
              const clipped=[...root.querySelectorAll('*')].filter(e=>visible(e)&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&e.clientWidth>0&&e.scrollWidth>e.clientWidth+1&&!['auto','scroll'].includes(getComputedStyle(e).overflowX)).map(e=>({tag:e.tagName,text:e.textContent.slice(0,60),overflow:e.scrollWidth-e.clientWidth}));
              const rgba=color=>{const v=color.match(/[0-9.]+/g)?.map(Number)??[0,0,0];return [v[0],v[1],v[2],v[3]??1]};
              const blend=(fg,bg)=>[...fg.slice(0,3).map((v,i)=>v*fg[3]+bg[i]*(1-fg[3])),1];
              const background=e=>{const chain=[];for(let n=e;n;n=n.parentElement)chain.unshift(n);return chain.reduce((bg,n)=>blend(rgba(getComputedStyle(n).backgroundColor),bg),[255,255,255,1])};
              const luminance=rgb=>rgb.slice(0,3).map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[0.2126,0.7152,0.0722][i],0);
              const contrast=[...root.querySelectorAll('*')].filter(e=>visible(e)&&!e.closest(':disabled')&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).flatMap(e=>{const s=getComputedStyle(e),bg=background(e),fg=blend(rgba(s.color),bg),a=luminance(fg),b=luminance(bg),ratio=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05),size=parseFloat(s.fontSize),minimum=size>=24||(size>=18.66&&Number(s.fontWeight)>=700)?3:4.5;return ratio+0.02<minimum?[{text:e.textContent.slice(0,60),ratio:Math.round(ratio*100)/100,minimum,color:s.color,background:bg}]:[]});
              return {small,clipped,contrast,overflow:document.documentElement.scrollWidth>innerWidth};
            }''')
            AUDITS.append({'screen': name, 'engine': engine, 'theme': theme, 'width': width, **result})
            assert not result['overflow'], (name, theme, width, 'page overflow')
            assert not result['clipped'], (name, theme, width, result['clipped'])
            assert not result['small'], (name, theme, width, result['small'])
        if engine == 'chromium':
            for kind, matrix in MATRICES.items():
                page.evaluate('''matrix=>{document.querySelector('#cvd-proof')?.remove();document.body.insertAdjacentHTML('beforeend',`<svg id="cvd-proof" width="0" height="0" style="position:absolute"><filter id="cvd-filter" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="${matrix}"/></filter></svg>`)}''', matrix)
                style = page.add_style_tag(content='body{filter:url(#cvd-filter)}')
                page.screenshot(path=str(OUT / f'{engine}-{name}-{theme}-{kind}.png'), full_page=True)
                style.evaluate('(e)=>e.remove()')
    page.emulate_media(color_scheme='light')
    page.set_viewport_size({'width': 390, 'height': 844})


def open_fixture(browser, url, block_workers=False):
    urllib.request.urlopen(urllib.request.Request(url + '/__reset', method='POST')).close()
    context = browser.new_context(viewport={'width':390,'height':844}, service_workers='block' if block_workers else 'allow')
    page = context.new_page()
    page.set_default_timeout(8000)
    page.goto(url)
    page.get_by_role('button', name=re.compile('Sample Strength')).click()
    expect(page.get_by_role('button', name=re.compile(r'^Start Day \d+$'))).to_be_visible()
    return context, page


def responsive_journey(browser, engine, url):
    context, page = open_fixture(browser, url)
    try:
        for name in ['Home','Program','Calendar','Progress']:
            page.get_by_role('navigation',name='Main').get_by_role('button',name=name,exact=True).click()
            capture(page,engine,name.lower())
            page.set_viewport_size({'width':1440,'height':900})
            assert page.locator('.app').bounding_box()['width'] > 1000
            nav=page.get_by_role('navigation',name='Main').bounding_box()
            content=page.locator('#content').bounding_box()
            assert nav['x']+nav['width'] <= content['x']
            if name=='Home':
                expect(page.locator('.hero-title')).to_have_text('Chest and back')
                left=page.locator('.home-workout').bounding_box()
                right=page.locator('.home-week').bounding_box()
                assert left['x']+left['width'] < right['x']
        print(f'PASS {engine}: desktop columns, navigation, focus labels and four responsive pages')
    finally:
        context.close()


def program_journey(browser, engine, url):
    context, page = open_fixture(browser, url)
    try:
        original = snapshot(page, ['session','session_slot','set'])
        page.get_by_role('navigation', name='Main').get_by_role('button', name='Program', exact=True).click()
        page.get_by_role('button', name='Change program', exact=True).click()
        page.get_by_role('button', name='New program', exact=True).click()
        page.get_by_label('Name', exact=True).fill('Fixture Builder')
        capture(page, engine, 'new-program')
        page.get_by_label('Copy Sample Strength',exact=True).check()
        expect(page.get_by_text('Days 1 to 3 fill Mon, Tue, Thu. Fri starts empty.',exact=True)).to_be_visible()
        page.get_by_label('Empty days',exact=True).check()
        page.get_by_role('button', name='Create 6 weeks × 4 days').click()
        expect(page.get_by_role('heading', name='Fixture Builder', exact=True)).to_be_visible()
        created = next(r for r in live_rows(page,'program') if r['name']=='Fixture Builder')
        days = [r for r in live_rows(page,'program_day') if r['program_id']==created['id']]
        assert len(days)==24
        assert snapshot(page,['session','session_slot','set'])==original
        page.get_by_text('Edit weeks',exact=True).click()
        page.get_by_role('button', name=re.compile('Edit Week 1, Day 1:')).click()
        expect(page.get_by_role('radio', name='This week only', exact=True)).to_have_attribute('aria-checked','true')
        page.get_by_label('Day name', exact=True).fill('Fixture Upper')
        page.get_by_role('heading', name='Edit day', exact=True).click()
        expect(page.get_by_label('Day name', exact=True)).to_have_value('Fixture Upper')
        page.get_by_role('button', name='+ Add exercise', exact=True).click()
        page.get_by_role('button', name=re.compile('^Decline Press')).click()
        page.get_by_role('button', name=re.compile('^Barbell Row')).click()
        page.get_by_role('button', name='Add 2 exercises', exact=True).click()
        page.get_by_role('button', name='Add 2 exercises', exact=True).click()
        expect(page.get_by_role('button', name='Change Decline Press', exact=True)).to_be_visible()
        page.get_by_role('button', name='Change Decline Press', exact=True).click()
        page.get_by_role('button', name='Superset with next exercise', exact=True).click()
        expect(page.locator('.superset-mark')).to_have_count(2)
        page.get_by_role('button', name='Change Decline Press', exact=True).click()
        page.get_by_role('button', name='Change sets', exact=True).click()
        page.get_by_role('button', name='Increase rest seconds', exact=True).click()
        page.get_by_role('button', name='Save sets', exact=True).click()
        expect(page.get_by_role('button', name='Change Decline Press', exact=True)).to_contain_text('105 s rest')
        capture(page, engine, 'day-editor')
        first = page.get_by_role('button', name='Drag to reorder Decline Press', exact=True).bounding_box()
        last = page.get_by_role('button', name='Change Barbell Row', exact=True).bounding_box()
        page.mouse.move(first['x']+20,first['y']+20);page.mouse.down()
        page.mouse.move(last['x']+20,last['y']+20,steps=6);page.mouse.up()
        expect(page.locator('.day-editor-row .row-main strong').first).to_have_text('Barbell Row')
        page.get_by_role('button', name='Change Decline Press', exact=True).click()
        page.get_by_role('button', name='Move up', exact=True).click()
        expect(page.locator('.day-editor-row .row-main strong').first).to_have_text('Decline Press')
        page.get_by_role('button', name='Change Decline Press', exact=True).click()
        page.get_by_role('button', name='Move down', exact=True).click()
        expect(page.locator('.day-editor-row .row-main strong').first).to_have_text('Barbell Row')
        page.keyboard.press('Escape')
        saved = [r for r in live_rows(page,'program_day') if r['program_id']==created['id']]
        assert sum(r.get('title')=='Fixture Upper' for r in saved)==1
        capture(page, engine, 'week-grid')
        page.get_by_role('button', name='Copy a week', exact=True).click()
        page.get_by_label('Week 2', exact=True).check()
        page.get_by_role('button', name='Copy Week 1', exact=True).click()
        target = next(r for r in saved if r['week']==2 and r['day']==1)
        expect(page.get_by_role('button',name=re.compile('Edit Week 2, Day 1.*2 exercises'))).to_be_visible()
        assert len([r for r in live_rows(page,'slot') if r['program_day_id']==target['id']])==2
        page.get_by_role('button', name='Add a week', exact=True).click()
        expect(page.get_by_role('button',name='Edit Week 7, Day 1: 0 exercises',exact=True)).to_be_visible()
        page.get_by_role('button',name=re.compile('Edit Week 2, Day 1.*2 exercises')).click()
        page.get_by_role('radio',name='Every week',exact=True).click()
        page.get_by_label('Day name',exact=True).fill('Shared Upper')
        page.get_by_role('heading',name='Edit day',exact=True).click()
        page.keyboard.press('Escape')
        assert sum(r.get('title')=='Shared Upper' for r in live_rows(page,'program_day') if r['program_id']==created['id'])==7
        assert snapshot(page,['session','session_slot','set'])==original
        print(f'PASS {engine}: blank program, scoped title, additions, supersets, pointer reorder, week copy and add')
    finally:
        context.close()


def choice_journey(browser, engine, url):
    context, page = open_fixture(browser,url)
    try:
        before = snapshot(page,['program','program_day','slot','slot_set','run','run_setting','run_event'])
        page.get_by_role('button',name='Other day',exact=True).click()
        capture(page,engine,'train-another-day')
        page.get_by_role('button',name=re.compile('Day 2')).click()
        page.get_by_label('Keep this as an extra workout').check()
        page.get_by_role('button',name='Start extra workout',exact=True).click()
        expect(page.get_by_role('button',name=re.compile('^Log set')).first).to_be_visible()
        extra = next(r for r in live_rows(page,'session') if r.get('program_day_id') is None and r.get('status')=='open')
        assert snapshot(page,['program','program_day','slot','slot_set','run','run_setting'])=={k:v for k,v in before.items() if k!='run_event'}
        page.get_by_role('button',name='Session',exact=True).click()
        page.get_by_role('button',name='Delete this workout',exact=True).click()
        page.get_by_role('button',name='Delete workout',exact=True).click()
        expect(page.get_by_role('button',name='Other day',exact=True)).to_be_visible()
        assert extra['id'] not in [r['id'] for r in live_rows(page,'session')]
        assert snapshot(page,['program','program_day','slot','slot_set','run','run_setting','run_event'])==before
        print(f'PASS {engine}: borrowed individual workout deletes without changing program or dates')
    finally:
        context.close()


def calendar_journey(browser, engine, url):
    context,page=open_fixture(browser,url)
    try:
        page.get_by_role('navigation',name='Main').get_by_role('button',name='Calendar',exact=True).click()
        page.locator('.calendar-day.planned').first.click()
        page.get_by_role('button',name='Move to another date',exact=True).click()
        capture(page,engine,'move-workout')
        expect(page.get_by_role('heading',name='What changes',exact=True)).to_be_visible()
        page.keyboard.press('Escape')
        page.locator('.calendar-day.planned').first.click()
        page.get_by_role('button',name='Skip or push back',exact=True).click()
        capture(page,engine,'skip-workout')
        page.get_by_role('button',name=re.compile('^Push back')).click()
        capture(page,engine,'push-workouts')
        page.get_by_role('button',name='Push everything back',exact=True).click()
        expect(page.get_by_text('Workouts pushed back',exact=True)).to_be_visible()
        page.get_by_role('button',name='Undo',exact=True).click()
        print(f'PASS {engine}: move, skip and push previews, saved push and Undo')
    finally:
        context.close()


def finished_editor_journey(browser, engine, url):
    context,page=open_fixture(browser,url)
    try:
        page.get_by_role('button',name='Other day',exact=True).click()
        page.get_by_role('button',name=re.compile('Day 2')).click()
        page.get_by_role('button',name='Start Day 2',exact=True).click()
        page.get_by_role('button',name='Session',exact=True).click()
        page.get_by_role('button',name='Finish early · keep 0 logged sets',exact=True).click()
        expect(page.get_by_role('heading',name='Finished early',exact=True)).to_be_visible()
        page.get_by_role('button',name='See sets',exact=True).click()
        page.get_by_role('button',name='Exercise menu for Bench Press',exact=True).click()
        page.get_by_role('button',name='Swap for today',exact=True).click()
        page.get_by_role('button',name='‹ Back',exact=True).click()
        expect(page.locator('.day-title')).to_have_text('Week 1 · Day 2')
        assert not [row for row in live_rows(page,'run_event') if row.get('position')==0 and row.get('kind')=='done']
        print(f'PASS {engine}: finished Day 2 editor keeps its own day while Day 1 remains next')
    finally:
        context.close()


def health_context_journey(browser, engine, url):
    context, page = open_fixture(browser, url, block_workers=True)
    requests = []

    def guidance(route, ttl=60, available=True):
        requests.append(route)
        now = datetime.now(timezone.utc)
        timestamp = lambda value: value.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        metrics = ['sleep', 'hrv', 'rhr', 'temperature', 'steps']
        advisory = {'schemaVersion': 1, 'source': 'health', 'subjectId': 'fixture-subject', 'advisoryId': 'fixture-advice', 'day': now.date().isoformat(), 'policyVersion': 'fixture-rule-v1', 'sourceRevision': 'fixture-revision', 'generatedAt': timestamp(now), 'validUntil': timestamp(now + timedelta(seconds=ttl)), 'computed': 'train', 'shown': 'lighter', 'headline': 'Fixture guidance.', 'ruleWords': 'This guidance does not change the plan.', 'missing': [], 'sets': {'low': 0.5, 'high': 0.7}, 'overridden': False, 'freshness': {'measuredOn': {key: None for key in metrics}, 'stale': {key: False for key in metrics}}}
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'available': available, 'reason': None if available else 'Fixture guidance unavailable.', 'advisory': advisory if available else None}))

    try:
        page.route('**/api/health-context', lambda route: guidance(route))
        page.get_by_role('button', name='Start Day 1', exact=True).click()
        expect(page.get_by_text('Fixture guidance.', exact=True)).to_be_visible()
        expect(page.get_by_text('Guidance range: 50–70% of planned sets. This does not change your workout.', exact=True)).to_be_visible()
        assert len(requests) == 1, f'{engine}: session start must request guidance once'
        page.wait_for_function('''async()=>{const r=indexedDB.open('workout-tracker');const db=await new Promise(resolve=>r.onsuccess=()=>resolve(r.result));const q=db.transaction('event').objectStore('event').getAll();return await new Promise(resolve=>q.onsuccess=()=>{db.close();resolve(q.result.some(row=>row.detail?.integration?.recordType==='health_advisory'&&row.detail.integration.advisoryId==='fixture-advice'))})}''')
        receipt_ids = [row['id'] for row in live_rows(page, 'event') if row.get('detail', {}).get('integration', {}).get('recordType') == 'health_advisory']
        assert len(receipt_ids) == 1
        receipt_id = receipt_ids[0]
        page.get_by_label('Set 1 weight in kg').first.fill('50')
        page.get_by_role('button', name='Log set 1', exact=True).first.click()
        page.wait_for_function('''()=>{const r=indexedDB.open('workout-tracker');return new Promise(resolve=>r.onsuccess=()=>{const db=r.result;const q=db.transaction('set').objectStore('set').getAll();q.onsuccess=()=>{db.close();resolve(q.result.some(row=>row.done_at!=null))}})}''')
        assert len(requests) == 1, f'{engine}: a set save must not fetch guidance again'
        page.get_by_role('button', name='Refresh guidance', exact=True).click()
        expect(page.get_by_text('Fixture guidance.', exact=True)).to_be_visible()
        assert len(requests) == 2, f'{engine}: explicit refresh must fetch guidance'
        assert len([row for row in live_rows(page, 'event') if row.get('id') == receipt_id]) == 1
        checkbox = page.get_by_label('I’m following this guidance', exact=True)
        assert not checkbox.is_checked(), f'{engine}: a receipt must not select guidance for the user'
        page.get_by_label('Why are you stopping?').select_option('time')
        page.get_by_role('button', name='Finish workout', exact=True).click()
        choice = next(row for row in live_rows(page, 'event') if row.get('detail', {}).get('integration', {}).get('recordType') == 'session_choice')
        assert choice['detail']['integration']['advisoryId'] is None, 'an old receipt must not link without an explicit selection'
        print(f'PASS {engine}: set save does not refetch; refresh fetches; receipt is not auto-selected')
    finally:
        context.close()

    context, page = open_fixture(browser, url, block_workers=True)
    requests = []
    try:
        page.route('**/api/health-context', lambda route: guidance(route))
        page.get_by_role('button', name='Start Day 1', exact=True).click()
        expect(page.get_by_text('Fixture guidance.', exact=True)).to_be_visible()
        page.get_by_label('I’m following this guidance', exact=True).check()
        page.get_by_label('Why are you stopping?').select_option('recovery')
        page.get_by_role('button', name='Finish workout', exact=True).click()
        choice = next(row for row in live_rows(page, 'event') if row.get('detail', {}).get('integration', {}).get('recordType') == 'session_choice')
        assert choice['detail']['integration']['advisoryId'] == 'fixture-advice', 'explicit current guidance selection must link its advisory ID'
        print(f'PASS {engine}: explicit guidance selection links the displayed advisory')
    finally:
        context.close()

    context, page = open_fixture(browser, url, block_workers=True)
    requests = []
    try:
        response_count = {'value': 0}
        def valid_then_error(route):
            response_count['value'] += 1
            guidance(route, available=response_count['value'] == 1)
        page.route('**/api/health-context', valid_then_error)
        page.get_by_role('button', name='Start Day 1', exact=True).click()
        expect(page.get_by_text('Fixture guidance.', exact=True)).to_be_visible()
        page.get_by_label('I’m following this guidance', exact=True).check()
        page.get_by_role('button', name='Refresh guidance', exact=True).click()
        expect(page.get_by_text('Fixture guidance unavailable.', exact=True)).to_be_visible()
        checkbox = page.get_by_label('I’m following this guidance', exact=True)
        assert not checkbox.is_checked() and not checkbox.is_enabled()
        page.get_by_label('Why are you stopping?').select_option('interruption')
        page.get_by_role('button', name='Finish workout', exact=True).click()
        choice = next(row for row in live_rows(page, 'event') if row.get('detail', {}).get('integration', {}).get('recordType') == 'session_choice')
        assert choice['detail']['integration']['advisoryId'] is None, 'an unavailable refresh clears the selected advisory'
        print(f'PASS {engine}: failed refresh clears advisory selection before close')
    finally:
        context.close()

    context, page = open_fixture(browser, url, block_workers=True)
    try:
        page.route('**/api/health-context', lambda route: guidance(route))
        page.get_by_role('button', name='Start Day 1', exact=True).click()
        expect(page.get_by_text('Fixture guidance.', exact=True)).to_be_visible()
        page.get_by_label('I’m following this guidance', exact=True).check()
        page.get_by_role('button', name='‹ Home', exact=True).click()
        page.get_by_role('button', name='Resume workout', exact=True).click()
        expect(page.get_by_text('Fixture guidance.', exact=True)).to_be_visible()
        checkbox = page.get_by_label('I’m following this guidance', exact=True)
        assert not checkbox.is_checked(), 'leaving and resuming clears the previous selection'
        page.get_by_label('Why are you stopping?').select_option('time')
        page.get_by_role('button', name='Finish workout', exact=True).click()
        choice = next(row for row in live_rows(page, 'event') if row.get('detail', {}).get('integration', {}).get('recordType') == 'session_choice')
        assert choice['detail']['integration']['advisoryId'] is None, 'unmount clears the selected advisory before a later close'
        print(f'PASS {engine}: unmount clears the current advisory selection')
    finally:
        context.close()

    context, page = open_fixture(browser, url, block_workers=True)
    try:
        page.route('**/api/health-context', lambda route: guidance(route, ttl=1))
        page.get_by_role('button', name='Start Day 1', exact=True).click()
        expect(page.get_by_text('Fixture guidance.', exact=True)).to_be_visible()
        page.get_by_label('I’m following this guidance', exact=True).check()
        expect(page.get_by_text('Health guidance expired. Refresh to request a current copy.', exact=True)).to_be_visible(timeout=5000)
        checkbox = page.get_by_label('I’m following this guidance', exact=True)
        assert not checkbox.is_checked() and not checkbox.is_enabled()
        page.get_by_label('Why are you stopping?').select_option('difficulty')
        page.get_by_role('button', name='Finish workout', exact=True).click()
        choice = next(row for row in live_rows(page, 'event') if row.get('detail', {}).get('integration', {}).get('recordType') == 'session_choice')
        assert choice['detail']['integration']['advisoryId'] is None, 'expired guidance cannot link at close'
        print(f'PASS {engine}: expired guidance cannot remain selected')
    finally:
        context.close()

    urllib.request.urlopen(urllib.request.Request(url + '/__reset', method='POST')).close()
    context = browser.new_context(viewport={'width':390,'height':844}, service_workers='block')
    page = context.new_page()
    pending = []
    try:
        page.route('**/api/health-context', lambda route: pending.append(route))
        page.goto(url)
        page.get_by_role('button', name=re.compile('Sample Strength')).click()
        page.get_by_role('button', name='Start Day 1', exact=True).click()
        expect(page.locator('.logger')).to_be_visible()
        page.wait_for_timeout(100)
        assert len(pending) == 1, f'{engine}: expected one held advisory request'
        page.get_by_role('button', name='‹ Home', exact=True).click()
        expect(page.get_by_role('button', name='Resume workout', exact=True)).to_be_visible()
        now = datetime.now(timezone.utc)
        timestamp = lambda value: value.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        try:
            pending[0].fulfill(status=200, content_type='application/json', body=json.dumps({'available': True, 'advisory': {'advisoryId': 'late-advice', 'policyVersion': 'fixture-rule-v1', 'validUntil': timestamp(now + timedelta(seconds=60)), 'headline': 'Late guidance.', 'ruleWords': 'Too late to display.', 'missing': [], 'sets': None, 'freshness': {'stale': {key: False for key in ['sleep', 'hrv', 'rhr', 'temperature', 'steps']}}}}))
        except Exception:
            pass  # Unmount may already have aborted the intercepted fetch.
        page.wait_for_timeout(100)
        assert not [row for row in live_rows(page, 'event') if row.get('detail', {}).get('integration', {}).get('recordType') == 'health_advisory'], 'unmounted guidance must not save an undisplayed receipt'
        print(f'PASS {engine}: unmount cancels the pending guidance request before receipt save')
    finally:
        context.close()


def program_history_journey(browser, engine, url):
    context,page=open_fixture(browser,url)
    try:
        page.get_by_role('navigation',name='Main').get_by_role('button',name='Program',exact=True).click()
        page.get_by_text('Edit weeks',exact=True).click()
        page.get_by_role('button',name=re.compile('Edit Week 1, Day 1')).click()
        page.get_by_role('button',name='Change Bench Press',exact=True).click()
        page.get_by_role('button',name='History',exact=True).click()
        expect(page.get_by_role('dialog',name='Bench Press',exact=True)).to_be_visible()
        page.screenshot(path=str(OUT/f'{engine}-program-history.png'),full_page=True)
        expect(page.locator('.exercise-history').get_by_role('combobox')).to_have_value('4:6')
        expect(page.locator('.exercise-history .results-list').first).to_contain_text('100 kg × 6')
        expect(page.get_by_text('Heaviest working set for 4 to 6 reps · last 2 sessions',exact=True)).to_be_visible()
        page.keyboard.press('Escape')
        expect(page.get_by_role('button',name='Change sets',exact=True)).to_be_visible()
        print(f'PASS {engine}: Program → day → exercise → History shows actual 6 reps and target 4 to 6')
    finally:
        context.close()


with sync_playwright() as p:
    for engine in [p.chromium,p.webkit]:
        browser=engine.launch()
        try:
            responsive_journey(browser,engine.name,sys.argv[1])
            health_context_journey(browser,engine.name,sys.argv[1])
            finished_editor_journey(browser,engine.name,sys.argv[1])
            program_history_journey(browser,engine.name,sys.argv[1])
            program_journey(browser,engine.name,sys.argv[1])
            choice_journey(browser,engine.name,sys.argv[1])
            calendar_journey(browser,engine.name,sys.argv[1])
        finally:
            browser.close()
            (OUT/'render-checks.json').write_text(json.dumps(AUDITS,indent=2))

contrast_failures={(entry['screen'],entry['theme'],row['text'],row['ratio'],row['minimum']) for entry in AUDITS for row in entry['contrast']}
assert not contrast_failures, sorted(contrast_failures)

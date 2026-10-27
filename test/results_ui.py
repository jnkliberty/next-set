"""Results journeys use only the isolated server's invented fixture rows."""
import json
import re
import sys
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect


AUDITS = []
MATRICES = {
    'deutan': '0.367322 0.860646 -0.227968 0 0 0.280085 0.672501 0.047413 0 0 -0.011820 0.042940 0.968881 0 0 0 0 0 1 0',
    'protan': '0.152286 1.052583 -0.204868 0 0 0.114503 0.786281 0.099216 0 0 -0.003882 -0.048116 1.051998 0 0 0 0 0 1 0',
}

def rows(page, table):
    return page.evaluate("""async table => {
      const request=indexedDB.open('workout-tracker');
      const db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
      const get=db.transaction(table).objectStore(table).getAll();
      const result=await new Promise((resolve,reject)=>{get.onsuccess=()=>resolve(get.result);get.onerror=()=>reject(get.error)});db.close();return result;
    }""", table)


def live_current(page, table):
    return [row for row in rows(page, table) if not row.get('deleted_at') and not row['id'].startswith('past-')]


def menu(page, name='Bench Press'):
    page.get_by_role('button', name='Exercise menu for '+name, exact=True).click()
    return page.get_by_role('dialog')


def capture(page, folder, name):
    for theme in ['light', 'dark']:
        page.emulate_media(color_scheme=theme)
        for width in [320, 390]:
            page.set_viewport_size({'width': width, 'height': 844})
            page.screenshot(path=str(folder/f'{name}-{theme}-{width}.png'), full_page=True)
            result = page.evaluate('''()=>{
              const root=document.querySelector('dialog[open]')??document.querySelector('.app');
              const visible=e=>!e.closest('.sr-only')&&e.getClientRects().length&&e.getBoundingClientRect().right>0&&getComputedStyle(e).visibility!=='hidden';
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
            AUDITS.append({'screen': name, 'theme': theme, 'width': width, **result})
            for check in ['overflow', 'clipped', 'small', 'contrast']:
                assert not result[check], (name, theme, width, check, result[check])
        if name.startswith('chromium-'):
            for kind, matrix in MATRICES.items():
                page.evaluate('matrix=>{document.querySelector(\'#cvd-proof\')?.remove();document.body.insertAdjacentHTML(\'beforeend\',`<svg id="cvd-proof" width="0" height="0" style="position:absolute"><filter id="cvd-filter" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="${matrix}"/></filter></svg>`)}', matrix)
                style = page.add_style_tag(content='body{filter:url(#cvd-filter)}')
                page.screenshot(path=str(folder/f'{name}-{theme}-{kind}.png'), full_page=True)
                style.evaluate('(e)=>e.remove()')
    page.emulate_media(color_scheme='light')
    page.set_viewport_size({'width': 390, 'height': 844})


def verify_delete_undo(page, folder, engine, session_id, logged_id):
    run_before_delete = rows(page, 'run')
    page.get_by_role('button', name='Session', exact=True).click()
    sheet = page.get_by_role('dialog')
    sheet.get_by_role('button', name='Delete this workout', exact=True).click()
    expect(sheet.get_by_text('This removes 1 logged set from your history.', exact=True)).to_be_visible()
    capture(page, folder, engine.name+'-delete-confirm')
    sheet.get_by_role('button', name='Keep workout', exact=True).click()
    assert not next(row for row in rows(page,'session') if row['id']==session_id).get('deleted_at')
    sheet.get_by_role('button', name='Delete this workout', exact=True).click()
    sheet.get_by_role('button', name='Delete workout', exact=True).click()
    page.get_by_role('status').filter(has_text='Workout deleted').wait_for()
    assert next(row for row in rows(page,'session') if row['id']==session_id).get('deleted_at')
    assert next(row for row in rows(page,'set') if row['id']==logged_id).get('deleted_at')
    assert rows(page, 'run') == run_before_delete
    skipped = [row for row in rows(page,'run_event') if row['id'].startswith('deleted:'+session_id+':') and not row.get('deleted_at')]
    assert len(skipped) == 1 and skipped[0]['kind'] == 'skipped' and skipped[0].get('session_id') is None
    assert not any(row.get('deleted_at') for row in rows(page,'session') if row['id'].startswith('past-'))
    page.get_by_role('status').filter(has_text='Workout deleted').get_by_role('button', name='Undo', exact=True).click()
    page.wait_for_function("""async id=>{const r=indexedDB.open('workout-tracker');const db=await new Promise(resolve=>r.onsuccess=()=>resolve(r.result));const get=db.transaction('session').objectStore('session').get(id);return await new Promise(resolve=>get.onsuccess=()=>{db.close();resolve(!get.result.deleted_at)})}""", arg=session_id)
    assert next(row for row in rows(page,'set') if row['id']==logged_id).get('done_at')
    assert not next(row for row in rows(page,'set') if row['id']==logged_id).get('deleted_at')
    assert rows(page, 'run') == run_before_delete
    assert next(row for row in rows(page,'run_event') if row['id']==skipped[0]['id']).get('deleted_at')


def verify_historical_extra(page, folder, engine, session_id):
    # Complete an extra workout, then delete it from the calendar's historical sheet.
    date = next(row for row in rows(page,'session') if row['id']==session_id)['local_date']
    page.get_by_role('navigation', name='Main').get_by_role('button', name='Calendar', exact=True).click()
    page.get_by_role('button', name=re.compile('^'+date+':')).click()
    page.get_by_role('dialog').get_by_role('button', name='Add workout', exact=True).click()
    page.get_by_role('dialog').locator('.card.list .list-row').first.click()
    page.get_by_role('dialog').get_by_role('button', name='Add workout', exact=True).click()
    page.get_by_role('button', name='Expand Bench Press', exact=True).click()
    page.get_by_role('article', name='Bench Press').get_by_role('textbox', name='Set 1 weight in kg', exact=True).fill('50')
    page.get_by_role('article', name='Bench Press').get_by_label('Set 1 reps', exact=True).fill('6')
    page.get_by_role('article', name='Bench Press').get_by_role('button', name='Log set 1', exact=True).click()
    extra = next(row for row in live_current(page,'session') if row.get('program_day_id') is None)
    page.get_by_role('button', name='Finish workout', exact=True).click()
    page.get_by_role('dialog', name='Finish workout?', exact=True).get_by_role('button', name='Finish workout', exact=True).click()
    expect(page.get_by_role('heading', name='Finished early', exact=True)).to_be_visible()
    page.get_by_role('button', name='Done', exact=True).click()
    page.get_by_role('navigation', name='Main').get_by_role('button', name='Calendar', exact=True).click()
    page.get_by_role('button', name=re.compile('^'+date+':')).click()
    page.get_by_role('dialog').get_by_role('button', name='Extra workout · See sets', exact=True).click()
    page.get_by_role('dialog').get_by_role('button', name='Delete this workout', exact=True).click()
    capture(page, folder, engine.name+'-historical-extra-delete')
    page.get_by_role('dialog').get_by_role('button', name='Delete workout', exact=True).click()
    page.get_by_role('status').filter(has_text='Workout deleted').wait_for()
    assert next(row for row in rows(page,'session') if row['id']==extra['id']).get('deleted_at')
    assert all(row.get('deleted_at') for row in rows(page,'run_event') if row.get('session_id')==extra['id'])
    assert not next(row for row in rows(page,'session') if row['id']==session_id).get('deleted_at')


def verify_paused_reopen(page):
    page.get_by_role('button', name='‹ Home', exact=True).click()
    page.get_by_role('navigation', name='Main').get_by_role('button', name='Program', exact=True).click()
    page.get_by_role('button', name='Options', exact=True).click()
    page.get_by_role('button', name='Pause for leave', exact=True).click()
    page.get_by_role('navigation', name='Main').get_by_role('button', name='Home', exact=True).click()
    page.get_by_role('button', name='Resume workout', exact=True).click()
    page.get_by_role('button', name='Finish workout', exact=True).click()
    page.get_by_role('dialog', name='Finish workout?', exact=True).get_by_role('button', name='Finish workout', exact=True).click()
    expect(page.get_by_role('heading', name='Finished early', exact=True)).to_be_visible()
    assert rows(page, 'run')[0]['status'] == 'paused'
    page.get_by_role('button', name='See sets', exact=True).click()
    page.get_by_role('button', name='Expand Bench Press', exact=True).click()
    page.get_by_role('article', name='Bench Press').get_by_role('button', name='Undo set 1', exact=True).click()
    expect(page.get_by_role('article', name='Bench Press').get_by_role('button', name='Log set 1', exact=True)).to_be_visible()
    assert rows(page, 'run')[0]['status'] == 'paused'
    # Move past the logger's one-second double-tap guard before logging the same set again.
    page.wait_for_timeout(1100)
    page.get_by_role('article', name='Bench Press').get_by_role('button', name='Log set 1', exact=True).click()
    page.get_by_role('button', name='‹ Home', exact=True).click()
    page.get_by_role('navigation', name='Main').get_by_role('button', name='Program', exact=True).click()
    page.get_by_role('button', name='Options', exact=True).click()
    page.get_by_role('button', name='Return from leave', exact=True).click()
    page.get_by_role('navigation', name='Main').get_by_role('button', name='Home', exact=True).click()
    page.get_by_role('button', name='Resume workout', exact=True).click()
    page.get_by_role('button', name='Expand Bench Press', exact=True).click()


def run(engine, url, folder):
    browser = engine.launch()
    context = browser.new_context(viewport={'width':390,'height':844}, device_scale_factor=1)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.request.post(url+'/__reset')
        page.goto(url)
        page.get_by_role('button', name=re.compile('Sample Strength')).click()
        page.get_by_role('button', name=re.compile(r'^Start Day \d+$')).click()
        bench = page.get_by_role('article', name='Bench Press')
        bench.get_by_role('button', name='Expand Bench Press', exact=True).click()
        bench.get_by_role('textbox', name='Set 1 weight in kg', exact=True).fill('50')
        bench.get_by_label('Set 1 reps', exact=True).fill('6')
        bench.get_by_role('button', name='Log set 1', exact=True).click()
        expect(bench.get_by_role('button', name='Undo set 1', exact=True)).to_be_visible()
        session_id = live_current(page, 'session')[0]['id']
        logged_id = next(row['id'] for row in live_current(page, 'set') if row.get('done_at'))
        verify_paused_reopen(page)
        sheet = menu(page)
        capture(page, folder, engine.name+'-exercise-menu')
        sheet.get_by_role('button', name='History', exact=True).click()
        history = page.get_by_role('dialog')
        expect(history.get_by_role('img')).to_have_count(1)
        expect(history.get_by_text('Recent', exact=True)).to_be_visible()
        assert 'estimated max' not in history.inner_text().lower()
        capture(page, folder, engine.name+'-exercise-history')
        history.get_by_role('button', name='kg lifted', exact=True).click()
        expect(history.get_by_role('img')).to_have_attribute('aria-label', re.compile('^kg lifted'))
        history.get_by_role('button', name='Close', exact=True).click()
        menu(page).get_by_role('button', name='How to', exact=True).click()
        expect(page.get_by_role('dialog')).to_contain_text('No instructions saved for this exercise.')
        page.keyboard.press('Escape')
        menu(page).get_by_role('button', name='Skip remaining sets', exact=True).click()
        expect(bench.get_by_role('button', name='Log set 2', exact=True)).to_have_count(0)
        assert next(row for row in rows(page, 'set') if row['id']==logged_id).get('done_at')
        page.get_by_role('status').filter(has_text='Remaining sets skipped').get_by_role('button', name='Undo', exact=True).click()
        expect(bench.get_by_role('button', name='Log set 2', exact=True)).to_be_visible()
        assert next(row for row in rows(page, 'set') if row['id']==logged_id).get('done_at')
        page.get_by_role('button', name=re.compile(r'^(Session|\d+ waiting)$')).click()
        sheet = page.get_by_role('dialog')
        sheet.get_by_role('button', name='Pause, resume from Home', exact=True).click()
        page.get_by_role('button', name='Resume workout', exact=True).click()
        page.get_by_role('button', name=re.compile(r'^(Session|\d+ waiting)$')).click()
        sheet = page.get_by_role('dialog')
        sheet.get_by_role('button', name=re.compile('^Finish early')).click()
        expect(page.get_by_role('heading', name='Finished early', exact=True)).to_be_visible()
        page.get_by_role('status').filter(has_text='Finished early').get_by_role('button', name='Undo', exact=True).click()
        expect(page.get_by_role('article', name='Bench Press')).to_be_visible()
        assert next(row for row in rows(page,'session') if row['id']==session_id)['status']=='open'
        page.get_by_role('button', name='Finish workout', exact=True).click()
        page.get_by_role('dialog', name='Finish workout?', exact=True).get_by_role('button', name='Finish workout', exact=True).click()
        expect(page.get_by_role('heading', name='Finished early', exact=True)).to_be_visible()
        expect(page.get_by_role('group', name='Session effort')).to_be_visible()
        assert next(row for row in rows(page,'session') if row['id']==session_id)['effort'] is None
        page.get_by_role('group', name='Session effort').get_by_role('button', name='8', exact=True).click()
        expect(page.get_by_role('group', name='Session effort').get_by_role('button', name=re.compile('^8'))).to_have_attribute('aria-pressed','true')
        assert next(row for row in rows(page,'session') if row['id']==session_id)['effort']==8
        capture(page, folder, engine.name+'-workout-complete')
        verify_delete_undo(page, folder, engine, session_id, logged_id)
        verify_historical_extra(page, folder, engine, session_id)
        assert not errors, errors
        print('PASS '+engine.name+': menu, chart, retained logs, skip Undo, optional effort, delete confirmation, delete Undo; screenshots '+str(folder))
    finally:
        context.close()
        browser.close()


with sync_playwright() as playwright:
    folder = Path(tempfile.mkdtemp(prefix='workout-results-proof-'))
    for engine in [playwright.chromium, playwright.webkit]:
        run(engine, sys.argv[1], folder)

    (folder/'visual-audits.json').write_text(json.dumps(AUDITS, indent=2))

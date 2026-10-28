"""Progress checks and actual screenshots, using invented records only."""
import json
import re
import sys
import urllib.request
import urllib.error
from pathlib import Path
from time import perf_counter, monotonic, sleep
from playwright.sync_api import sync_playwright, expect

OUT = Path('data/proof/progress')
OUT.mkdir(parents=True, exist_ok=True)
AUDITS = []
CVD = {
    'deutan': '0.367322 0.860646 -0.227968 0 0 0.280085 0.672501 0.047413 0 0 -0.011820 0.042940 0.968881 0 0 0 0 0 1 0',
    'protan': '0.152286 1.052583 -0.204868 0 0 0.114503 0.786281 0.099216 0 0 -0.003882 -0.048116 1.051998 0 0 0 0 0 1 0',
}


def wait_for_fixture(base, available):
    deadline = monotonic() + 5
    while monotonic() < deadline:
        try:
            with urllib.request.urlopen(base + '/api/health', timeout=.2) as response:
                connected = response.status == 200
        except (urllib.error.URLError, TimeoutError):
            connected = False
        if connected == available:
            return
        sleep(.05)
    raise AssertionError(f'Fixture network availability did not become {available}')


def audit(page, name):
    result = page.evaluate('''() => {
      const root=document.querySelector('.progress-page');
      const visible=e=>!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('details:not([open]) :not(summary)');
      const small=[...root.querySelectorAll('button,input,select,summary')].filter(visible).map(e=>{const target=e.matches('input[type=checkbox]')?e.closest('label'):e;const r=target.getBoundingClientRect();return {label:e.getAttribute('aria-label')??e.textContent,width:r.width,height:r.height}}).filter(r=>r.width<43.5||r.height<43.5);
      const clipped=[...root.querySelectorAll('*')].filter(e=>visible(e)&&e.clientWidth>0&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&e.scrollWidth>e.clientWidth+1&&!['auto','scroll'].includes(getComputedStyle(e).overflowX)).map(e=>e.textContent.slice(0,80));
      const sizes=[...new Set([...root.querySelectorAll('*')].filter(e=>visible(e)&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>parseFloat(getComputedStyle(e).fontSize)))];
      const color=value=>{const v=value.match(/[0-9.]+/g)?.map(Number)??[0,0,0];return [v[0],v[1],v[2],v[3]??1]};
      const blend=(a,b)=>[...a.slice(0,3).map((v,i)=>v*a[3]+b[i]*(1-a[3])),1];
      const background=e=>{const chain=[];for(let n=e;n;n=n.parentElement)chain.unshift(n);return chain.reduce((bg,n)=>blend(color(getComputedStyle(n).backgroundColor),bg),[255,255,255,1])};
      const lum=rgb=>rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
      const contrast=[...root.querySelectorAll('*')].filter(e=>visible(e)&&![...e.children].length&&e.textContent.trim()&&!['TITLE','OPTION'].includes(e.tagName.toUpperCase())).flatMap(e=>{const s=getComputedStyle(e),bg=background(e),fg=blend(color(e instanceof SVGElement?s.fill:s.color),bg);const a=lum(fg),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05),size=parseFloat(s.fontSize),min=size>=24||(size>=18.66&&Number(s.fontWeight)>=700)?3:4.5;return ratio+.02<min?[{text:e.textContent.slice(0,60),ratio}]:[]});
      return {small,clipped,sizes,contrast,overflow:document.documentElement.scrollWidth>innerWidth};
    }''')
    AUDITS.append({'name': name, **result})
    assert not result['overflow'], (name, result)
    assert not result['clipped'], (name, result['clipped'])
    assert not result['small'], (name, result['small'])
    assert not result['contrast'], (name, result['contrast'])
    assert set(result['sizes']) <= {11, 13, 15, 17, 22, 34}, (name, result['sizes'])


def capture(page, engine, mode):
    for theme in ['light', 'dark']:
        page.emulate_media(color_scheme=theme)
        for width in [320, 390, 900, 1440]:
            page.set_viewport_size({'width': width, 'height': 1000})
            page.locator('.progress-page').wait_for()
            page.screenshot(path=str(OUT / f'{engine}-{mode}-{theme}-{width}.png'), full_page=True)
            audit(page, f'{engine}-{mode}-{theme}-{width}')
        if engine == 'chromium' and mode == 'populated':
            for kind, matrix in CVD.items():
                page.evaluate('''matrix=>{document.querySelector('#cvd-proof')?.remove();document.body.insertAdjacentHTML('beforeend',`<svg id="cvd-proof" width="0" height="0" style="position:absolute"><filter id="cvd-filter" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="${matrix}"/></filter></svg>`)}''', matrix)
                style = page.add_style_tag(content='body{filter:url(#cvd-filter)}')
                page.screenshot(path=str(OUT / f'{engine}-{mode}-{theme}-{kind}.png'), full_page=True)
                style.evaluate('(e)=>e.remove()')
    page.emulate_media(color_scheme='light')
    page.set_viewport_size({'width': 390, 'height': 844})


def exercise_charts(page):
    total = page.locator('.progress-totals').inner_text()
    activity = page.locator('.activity-reading').inner_text()
    original_count = page.locator('select[aria-label="Recorded session"] option').count()
    page.get_by_role('button', name='Chest', exact=True).click()
    expect(page.locator('.lift-detail h3').first).to_have_text('Bench Press')
    assert page.locator('.progress-totals').inner_text() == total
    assert page.locator('.activity-reading').inner_text() == activity
    assert page.locator('.trend-row').count() == 2
    direct_sets = float(page.locator('.work-reading strong').inner_text())
    page.get_by_role('button', name='Arms', exact=True).click()
    arms = float(page.locator('.work-reading strong').inner_text())
    page.get_by_label('Include secondary work').check()
    assert float(page.locator('.work-reading strong').inner_text()) > arms
    page.get_by_label('Include secondary work').uncheck()
    page.get_by_role('button', name='Chest', exact=True).click()
    page.get_by_role('button', name='4 weeks', exact=True).click()
    assert page.locator('select[aria-label="Recorded session"] option').count() < original_count
    assert float(page.locator('.work-reading strong').inner_text()) < direct_sets
    page.get_by_role('button', name='12 weeks', exact=True).click()
    page.get_by_text('Period details', exact=True).click()
    expect(page.get_by_text('Previous 84 days', exact=True)).to_be_visible()
    page.get_by_text('Period details', exact=True).click()
    page.get_by_label('Measure', exact=True).select_option('load')
    expect(page.locator('.strength-reading .chart-label').first).to_have_text('Recorded load')
    page.get_by_label('Measure', exact=True).select_option('estimate')
    chart = page.locator('.strength-chart .recharts-surface')
    chart.focus()
    page.keyboard.press('ArrowRight')
    expect(page.locator('.strength-chart .progress-tooltip')).to_be_visible()
    page.get_by_role('button', name='See sets', exact=True).click()
    expect(page.get_by_role('dialog')).to_be_visible()
    page.get_by_role('button', name='Close', exact=True).click()
    expect(page.get_by_role('button', name='Chest', exact=True)).to_have_attribute('aria-pressed', 'true')
    page.get_by_role('button', name='Core', exact=True).click()
    expect(page.locator('.strength-reading')).to_contain_text('sec')
    page.get_by_role('button', name='Other', exact=True).click()
    expect(page.get_by_text('No lifts in this selection', exact=True)).to_be_visible()
    page.get_by_role('button', name='All areas', exact=True).click()
    page.get_by_role('button', name='1 year', exact=True).click()
    assert page.locator('.activity-map rect').count() == 365
    page.get_by_label('Activity measure').select_option('minutes')
    page.get_by_role('button', name='All', exact=True).click()
    page.locator('.activity-years button').first.click()
    expect(page.get_by_role('button', name='All years', exact=True)).to_be_visible()
    page.get_by_role('button', name='12 weeks', exact=True).click()


def run(engine, base, mode):
    browser = engine.launch()
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, timezone_id='Pacific/Honolulu')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.goto(base + '/#progress')
        expect(page.locator('.progress-totals dd').first).to_have_text('0' if mode == 'empty' else '1' if mode == 'sparse' else re.compile(r'[1-9]\d+'))
        if mode in ['populated', 'weight']:
            page.get_by_role('button', name='Chest', exact=True).click()
        if mode == 'weight':
            expect(page.locator('.body-weight .weight-chart')).to_be_visible()
        capture(page, engine.name, mode)
        if mode == 'populated':
            exercise_charts(page)
        elif mode == 'sparse':
            expect(page.get_by_text('One recorded point.', exact=False)).to_be_visible()
            assert page.locator('.strength-chart .recharts-line-dot').count() == 1
        else:
            if mode == 'empty':
                expect(page.get_by_text('Your progress starts with a session', exact=True)).to_be_visible()
                expect(page.locator('.body-weight')).to_have_count(0)
            else:
                card = page.locator('.body-weight')
                expect(card).to_be_visible()
                expect(card.get_by_text('Daily readings and a trailing 7-day mean of measured days.', exact=False)).to_be_visible()
                details = card.locator('details.chart-data')
                details.locator('summary').click()
                expect(details.locator('tbody tr')).to_have_count(17)
                expect(details).to_contain_text('82 kg')
                expect(details).to_contain_text('Times use America/Chicago.')
                expect(card.locator('.weight-chart .recharts-line')).to_have_count(2)
                page.get_by_role('button', name='All', exact=True).click()
                older_date = page.evaluate('''() => {
                  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date());
                  const older=new Date(`${today}T12:00:00Z`);older.setUTCDate(older.getUTCDate()-500);
                  const parts=new Intl.DateTimeFormat('en-US',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}).formatToParts(older);
                  const part=type=>parts.find(item=>item.type===type).value;
                  return `${part('weekday')} ${part('day')} ${part('month')}`;
                }''')
                expect(page.locator('.progress-period')).to_contain_text(older_date)
                expect(details.locator('tbody tr')).to_have_count(18)
                expect(details).to_contain_text('80 kg')
        page.wait_for_function('navigator.serviceWorker.controller !== null')
        # WebKit's forced offline mode blocks navigation before the worker runs. Stop the fixture server instead.
        page.request.post(base + '/__stop')
        wait_for_fixture(base, False)
        start = perf_counter()
        page.reload(wait_until='domcontentloaded')
        page.locator('.progress-page').wait_for()
        if mode == 'weight':
            expect(page.locator('.body-weight')).to_contain_text('Health is unavailable; showing saved readings.')
        elapsed = (perf_counter() - start) * 1000
        assert elapsed < 1000, elapsed
        if mode == 'weight':
            page.locator('.body-weight details summary').click()
            expect(page.locator('.body-weight details tbody tr')).to_have_count(17)
        context.set_offline(True)
        page.get_by_role('button', name='4 weeks', exact=True).click()
        expect(page.get_by_role('button', name='4 weeks', exact=True)).to_have_attribute('aria-pressed', 'true')
        assert not errors, errors
        print(json.dumps({'engine': engine.name, 'mode': mode, 'offline_ms': round(elapsed), 'render_checks': 8, 'errors': errors}), flush=True)
        context.set_offline(False)
        wait_for_fixture(base, True)
    except Exception:
        print(json.dumps({'engine': engine.name, 'mode': mode, 'errors': errors, 'controls': page.locator('select[aria-label="Measure"]').evaluate_all("nodes=>nodes.map(e=>({html:e.outerHTML,rect:e.getBoundingClientRect().toJSON(),display:getComputedStyle(e).display,visibility:getComputedStyle(e).visibility,details:e.closest('details')?.outerHTML.slice(0,200)}))")}), flush=True)
        page.screenshot(path=str(OUT / f'{engine.name}-{mode}-failure.png'), full_page=True)
        raise
    finally:
        context.close()
        browser.close()


try:
    with sync_playwright() as playwright:
        for engine in [playwright.chromium, playwright.webkit]:
            run(engine, sys.argv[1], sys.argv[2])
finally:
    (OUT / f'audits-{sys.argv[2]}.json').write_text(json.dumps(AUDITS, indent=2) + '\n')

import sys
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    for engine in [p.chromium, p.webkit]:
        browser = engine.launch()
        context = browser.new_context()
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        try:
            page.request.post(sys.argv[1] + '/__reset')
            page.goto(sys.argv[1] + '/__fault')
            page.evaluate('window.faultReady')
            result = page.evaluate('''async () => {
                const local=window.faultStore;
                await local.save([{table:'setting',row:{id:'refused',value:'keep me'}}]);
                const queued=await local.db.getAll('outbox');
                const before=await local.db.get('setting','refused');
                const original=window.fetch;
                window.fetch=async(path,options)=>String(path)==='/api/sync'
                  ? new Response(JSON.stringify({results:JSON.parse(options.body).operations.map(op=>({id:op.id,status:'rejected',reason:'invalid_operation',row:{...op.row,value:'server'}}))}),{status:200})
                  : original(path,options);
                await local.sync();window.fetch=original;
                return {before,after:await local.db.get('setting','refused'),queued,afterQueue:await local.db.getAll('outbox'),status:await local.status()};
            }''')
            assert result['before'] == result['after'], 'Refused edit was overwritten'
            assert result['queued'] == result['afterQueue'], 'Refused edit left the outbox'
            assert result['status'].get('error'), 'Refusal has no visible status error'
            print(f'PASS {engine.name}: invalid operation keeps row and operation; exposes error')
            page.evaluate('''async () => {
                const local=window.faultStore;
                await local.sync();
                const changes=[
                  {table:'run',row:{id:'recovery-run',program_id:'sample',start_date:'2026-10-24',next_position:1,status:'active'}},
                  {table:'run_setting',row:{id:'recovery-schedule',run_id:'recovery-run',from_date:'2026-10-24',days_per_week:2,weekdays:[1,4],weekly_target:2}},
                  {table:'run_event',row:{id:'recovery-event',run_id:'recovery-run',kind:'added',local_date:'2026-10-24',position:null}},
                  {table:'session',row:{id:'recovery-session',run_id:'recovery-run',program_day_id:null,started_at:1,timezone:'America/Chicago',local_date:'2026-10-24',source:'app',status:'done'}},
                  {table:'session_slot',row:{id:'recovery-slot',session_id:'recovery-session',exercise_id:'press',position:0,name:'Fixture press'}},
                  {table:'set',row:{id:'recovery-set',session_slot_id:'recovery-slot',position:0,type:'working',local_date:'2026-10-24',done_at:2,grams:40000,weight:40,unit:'kg',reps:6}},
                  {table:'exercise',row:{id:'deleted-exercise',name:'Deleted fixture',equipment:'barbell',primary:[],secondary:[],weight_basis:'total',conditioning:false,deleted_at:10}}
                ];
                await local.save(changes);await local.sync();
                window.beforeRestore=await local.snapshot();
            }''')
            assert page.evaluate('window.faultStore.status()').get('error') is None, 'Resolved refusal left a stale error'
            page.request.post(sys.argv[1] + '/__reset')
            result = page.evaluate('''async () => {
                const local=window.faultStore;await local.sync();
                const remote=(await (await fetch('/api/changes?since=0')).json()).rows;
                const missing=[];
                for(const [table,rows] of Object.entries(window.beforeRestore)){
                  if(['event','set_edit'].includes(table))continue;
                  for(const row of rows){
                    const actual=remote.find(item=>item.table===table&&item.row.id===row.id)?.row;
                    const {seq,...expected}=row;const {seq:remoteSeq,...received}=actual||{};
                    if(JSON.stringify(Object.entries(expected).sort())!==JSON.stringify(Object.entries(received).sort()))missing.push(table+':'+row.id);
                  }
                }
                return {missing,status:await local.status()};
            }''')
            assert result['missing'] == [], result['missing']
            assert result['status']['waiting'] == 0
            assert result['status']['check']['ok'] is True
            page.evaluate('window.faultStore.resend()')
            page.evaluate('window.faultStore.sync()')
            assert page.evaluate('window.faultStore.status()')['waiting'] == 0
            print(f'PASS {engine.name}: restore and manual resend preserve all training rows and tombstones; count check agrees')
            result=page.evaluate('''async()=>{
                const local=window.faultStore;
                const before=(await local.db.getAll('event')).filter(row=>row.kind==='count_check').length;
                await local.check();await local.check();
                const after=(await local.db.getAll('event')).filter(row=>row.kind==='count_check').length;
                return {before,after};
            }''')
            assert result['before']==result['after'], 'Unchanged count checks added tool events'
            result=page.evaluate('''async()=>{
                const local=window.faultStore;
                await local.save(Array.from({length:1100},(_,i)=>({table:'setting',row:{id:'page-'+i,value:i,deleted_at:i%3===0?1:null}})));
                await local.sync();const expected=await local.db.getAll('setting');
                await local.db.clear('setting');await local.db.put('meta',0,'cursor');
                let pages=0;const original=fetch;window.fetch=async(...args)=>{if(String(args[0]).startsWith('/api/changes'))pages++;return original(...args);};
                await local.sync();window.fetch=original;
                return {pages,equal:JSON.stringify(expected)===JSON.stringify(await local.db.getAll('setting'))};
            }''')
            assert result['pages']>1 and result['equal'], result
            print(f'PASS {engine.name}: paged first download equals phone copy; unchanged count checks add no events')
            result = page.evaluate('''async () => {
                const local=window.faultStore, key=['draft','fixture-session','fixture-set'];
                const original=IDBObjectStore.prototype.put;
                let failed=false;
                try {
                    IDBObjectStore.prototype.put=function(...args){if(this.name==='meta')throw new Error('Fixture storage failure');return original.apply(this,args);};
                    await local.drafts.write(key,{values:{weight:'107.5'},unit:'kg',base:'fixture'});
                } catch { failed=true; } finally { IDBObjectStore.prototype.put=original; }
                await local.drafts.flush();
                return {failed, value:await local.db.get('meta',key), pending:local.drafts.hasPending()};
            }''')
            assert result['failed'] and (result.get('value') or {}).get('values', {}).get('weight') == '107.5' and not result['pending'], result
            result = page.evaluate('''async () => {
                const local=window.faultStore, key=['draft','fixture-session','fixture-set'], other=['draft','fixture-session','other-set'];
                await local.save([{table:'set',row:{id:'fixture-set',session_slot_id:'slot',position:0,type:'working',local_date:'2026-01-01',weight:50,unit:'kg',reps:5,done_at:null}}]);
                const outbox=await local.db.count('outbox');
                await Promise.all(['1','10','107.5'].map(weight=>local.drafts.write(key,{values:{weight},unit:'kg',base:'fixture'})));
                await local.drafts.write(other,{values:{weight:'42'},unit:'kg',base:'other'});
                const latest=await local.db.get('meta',key), draftOnly=outbox===await local.db.count('outbox');
                let failed=false, stale=false;
                try { await local.save([{table:'set',row:{id:'fixture-set',done_at:1,reps:-1}}]); } catch { failed=true; }
                const retained=await local.db.get('meta',key);
                try { await local.save([{table:'set',row:{id:'fixture-set',done_at:1}}],null,{'set:fixture-set':'changed'}); } catch { stale=true; }
                await local.save([{table:'set',row:{id:'fixture-set',done_at:2}}]);
                const cleared=(await local.db.get('meta',key))===undefined, otherKept=await local.db.get('meta',other);
                return {latest,draftOnly,failed,retained,stale,cleared,otherKept};
            }''')
            assert result['latest']['values']['weight'] == '107.5' and result['draftOnly'], result
            assert result['failed'] and result['retained'] == result['latest'] and result['stale'], result
            assert result['cleared'] and result['otherKept']['values']['weight'] == '42', result
            print(f'PASS {engine.name}: failed draft write retries latest input; failed/stale log retains draft; committed log clears only its draft')
            result = page.evaluate('''async () => {
                const local=window.faultStore;
                const saved=await local.save([{table:'set',row:{id:'fixture-set',weight:55}}, {table:'set',row:{id:'fixture-set',reps:7}}]);
                const row=await local.db.get('set','fixture-set'), count=await local.db.count('outbox');
                let failed=false, storageFailed=false;
                try { await local.save([{table:'set',row:{id:'fixture-set',weight:60}}, {table:'set',row:{id:'fixture-set',reps:-1}}]); } catch { failed=true; }
                const original=IDBObjectStore.prototype.put;
                try {
                    IDBObjectStore.prototype.put=function(...args){if(this.name==='outbox' && args[0].row.id==='batch-error')throw new Error('Fixture write failure');return original.apply(this,args);};
                    await local.save([{table:'set',row:{id:'fixture-set',weight:65}}, {table:'setting',row:{id:'batch-error',value:true}}]);
                } catch { storageFailed=true; } finally { IDBObjectStore.prototype.put=original; }
                return {saved:saved.rows.map(change=>change.row),row,failed,storageFailed,partial:(await local.db.get('setting','batch-error'))!==undefined,after:await local.db.get('set','fixture-set'),count,afterCount:await local.db.count('outbox')};
            }''')
            assert result['row']['weight'] == 55 and result['row']['reps'] == 7, result
            assert result['saved'][1]['weight'] == 55 and result['saved'][1]['rev'] == result['saved'][0]['rev'] + 1, result
            assert result['failed'] and result['row'] == result['after'] and result['count'] == result['afterCount'], result
            assert result['storageFailed'] and not result['partial'] and not errors, (result, errors)
            print(f'PASS {engine.name}: batched saves preserve repeated-row order and fully roll back invalid rows or failed storage writes')
        finally:
            context.close()
            browser.close()

import asyncio
import json
from browser_qa import Browser, OUT

async def main():
    b=Browser()
    await b.connect()
    report={}
    try:
        await b.call('Emulation.setDeviceMetricsOverride',width=1440,height=1000,deviceScaleFactor=1,mobile=False)
        await b.call('Page.navigate',url='http://127.0.0.1:8011/')
        await b.until("document.getElementById('orbitSatCount')?.textContent==='128'")
        await b.js("document.getElementById('analysisTab').click();var e=document.getElementById('dur');e.value='2';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('tradeBtn').click();")
        await b.until("!document.getElementById('runBtn').disabled && document.querySelectorAll('#resultTable tbody tr').length===6")
        report['comparison']=await b.js("({rows:document.querySelectorAll('#resultTable tbody tr').length,metricsHidden:document.getElementById('metricsCard').hidden,chartHidden:document.getElementById('chartCard').hidden,exportsEnabled:!document.getElementById('exportJsonBtn').disabled})")
        await b.js("document.getElementById('orbitTab').click();var e=document.getElementById('mode');e.value='multi_shell';e.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('previewBtn').click();")
        await b.until("!document.getElementById('previewBtn').disabled && document.getElementById('orbitSatCount').textContent==='200'")
        report['multiPreview']=await b.js("({satellites:document.getElementById('orbitSatCount').textContent,planes:document.getElementById('orbitPlaneCount').textContent,altitude:document.getElementById('orbitAltitude').textContent,period:document.getElementById('orbitPeriod').textContent})")
        await b.js("document.getElementById('analysisTab').click();document.getElementById('runBtn').click()")
        await b.until("!document.getElementById('runBtn').disabled && !document.getElementById('analysisResults').hidden")
        report['multiAnalysis']=await b.js("({satellites:document.getElementById('kSat').textContent,tradeDisabled:document.getElementById('tradeBtn').disabled})")
        await b.js("document.getElementById('orbitTab').click();var e=document.getElementById('mode');e.value='tle';e.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('previewBtn').click();")
        await b.until("!document.getElementById('previewBtn').disabled && document.getElementById('orbitSatCount').textContent==='1'")
        report['tlePreview']=await b.js("({satellites:document.getElementById('orbitSatCount').textContent,planes:document.getElementById('orbitPlaneCount').textContent,geometryDisabled:document.getElementById('groundTrackOn').disabled})")
        await b.js("document.getElementById('analysisTab').click();document.getElementById('runBtn').click()")
        await b.until("!document.getElementById('runBtn').disabled && !document.getElementById('analysisResults').hidden")
        report['tleAnalysis']=await b.js("({satellites:document.getElementById('kSat').textContent,tradeDisabled:document.getElementById('tradeBtn').disabled})")
        await b.call('Emulation.setDeviceMetricsOverride',width=390,height=844,deviceScaleFactor=1,mobile=True)
        await b.js("document.getElementById('settingsToggle').click()")
        report['mobileSettings']=await b.js("({expanded:document.getElementById('settingsToggle').getAttribute('aria-expanded'),visible:getComputedStyle(document.getElementById('settingsPanel')).display!=='none',overflow:document.documentElement.scrollWidth>innerWidth})")
    except Exception as e:
        report['failure']=repr(e)
    finally:
        report['exceptions']=[e for e in b.events if e['method']=='Runtime.exceptionThrown']
        (OUT/'browser-modes-report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
        print(json.dumps(report,ensure_ascii=True))
        await b.ws.close()

asyncio.run(main())

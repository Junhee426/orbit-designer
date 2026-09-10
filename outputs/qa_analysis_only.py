import asyncio
from browser_qa import Browser

async def main():
    b=Browser()
    await b.connect()
    try:
        await b.call('Emulation.setDeviceMetricsOverride',width=1440,height=1000,deviceScaleFactor=1,mobile=False)
        await b.js("document.getElementById('analysisTab').click();document.getElementById('dur').value='2';document.getElementById('runBtn').click()")
        await b.until("!document.getElementById('runBtn').disabled && !document.getElementById('analysisResults').hidden")
        print(await b.js("({ready:!document.getElementById('exportCsvBtn').disabled,legend:document.querySelector('#coverage .legend').getBoundingClientRect().toJSON(),axis:document.querySelector('#coverage .xtitle').getBoundingClientRect().toJSON()})"))
        await b.screenshot('qa-analysis-results.png',1440,1000)
    finally:
        await b.ws.close()

asyncio.run(main())

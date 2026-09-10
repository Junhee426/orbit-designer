"""Temporary Chrome CDP smoke test; Chrome must already listen on port 9222."""
import asyncio
import base64
import json
from pathlib import Path
from urllib.request import urlopen

import websockets


OUT = Path(__file__).resolve().parent


class Browser:
    def __init__(self):
        self.serial = 0
        self.waiters = {}
        self.events = []

    async def connect(self):
        pages = json.load(urlopen("http://127.0.0.1:9222/json/list"))
        page = next(p for p in pages if p["type"] == "page")
        self.ws = await websockets.connect(page["webSocketDebuggerUrl"], max_size=40_000_000)
        self.reader = asyncio.create_task(self.receive())
        for name in ("Page.enable", "Runtime.enable", "Network.enable", "Log.enable"):
            await self.call(name)
        await self.call("Network.setCacheDisabled", cacheDisabled=True)

    async def receive(self):
        async for raw in self.ws:
            msg = json.loads(raw)
            if "id" in msg:
                self.waiters.pop(msg["id"]).set_result(msg)
            else:
                self.events.append(msg)

    async def call(self, method, **params):
        self.serial += 1
        waiter = asyncio.get_running_loop().create_future()
        self.waiters[self.serial] = waiter
        await self.ws.send(json.dumps({"id": self.serial, "method": method, "params": params}))
        msg = await asyncio.wait_for(waiter, 60)
        if "error" in msg:
            raise RuntimeError(msg["error"])
        return msg.get("result", {})

    async def js(self, expression):
        value = await self.call("Runtime.evaluate", expression=expression, returnByValue=True, awaitPromise=True)
        if "exceptionDetails" in value:
            raise RuntimeError(value["exceptionDetails"])
        return value.get("result", {}).get("value")

    async def until(self, expression, seconds=40):
        for _ in range(seconds * 4):
            if await self.js(expression):
                return True
            await asyncio.sleep(.25)
        raise TimeoutError(expression)

    async def screenshot(self, name, width, height, mobile=False):
        await self.call("Emulation.setDeviceMetricsOverride", width=width, height=height, deviceScaleFactor=1, mobile=mobile)
        await asyncio.sleep(1)
        shot = await self.call("Page.captureScreenshot", format="png", captureBeyondViewport=False)
        path = OUT / name
        path.write_bytes(base64.b64decode(shot["data"]))
        return str(path)

    def requests(self):
        return [e["params"]["request"]["url"] for e in self.events if e["method"] == "Network.requestWillBeSent" and "/api/" in e["params"]["request"]["url"]]


async def main():
    browser = Browser()
    await browser.connect()
    report = {"screenshots": []}
    try:
        await browser.call("Emulation.setDeviceMetricsOverride", width=1440, height=1000, deviceScaleFactor=1, mobile=False)
        await browser.call("Page.navigate", url="http://127.0.0.1:8011/")
        await browser.until("Boolean(document.getElementById('previewBtn')) && !document.getElementById('previewBtn').disabled && document.getElementById('orbitSatCount').textContent.trim() === '128'", seconds=60)
        report["initial"] = await browser.js("({workspace:document.body.dataset.workspace, snapshotCount:document.getElementById('orbitSatCount').textContent, analysisHidden:document.getElementById('analysisResults').hidden, status:document.getElementById('status').textContent, horizontalOverflow:document.documentElement.scrollWidth>innerWidth})")
        report["initial"]["requests"] = browser.requests()
        report["screenshots"].append(await browser.screenshot("qa-orbit-desktop.png", 1440, 1000))
        report["screenshots"].append(await browser.screenshot("qa-orbit-wide.png", 1920, 1080))
        await browser.js("document.getElementById('analysisTab').click()")
        await browser.until("document.body.dataset.workspace==='analysis'")
        report["analysisEmpty"] = await browser.js("({workspace:document.body.dataset.workspace, empty:!document.getElementById('analysisEmpty').hidden, resultsHidden:document.getElementById('analysisResults').hidden, orbitHidden:getComputedStyle(document.querySelector('section[data-view=orbit]')).display==='none', title:document.getElementById('workspaceTitle').textContent})")
        report["screenshots"].append(await browser.screenshot("qa-analysis-empty.png", 1440, 1000))
        await browser.js("for (const [id,value] of [['dur','2'],['step','60']]) {let e=document.getElementById(id);e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));} document.getElementById('runBtn').click()")
        await browser.until("!document.getElementById('runBtn').disabled && !document.getElementById('analysisResults').hidden", seconds=60)
        report["analysisResults"] = await browser.js("({workspace:document.body.dataset.workspace,emptyHidden:document.getElementById('analysisEmpty').hidden, resultsHidden:document.getElementById('analysisResults').hidden, satCount:document.getElementById('kSat').textContent, rows:document.querySelectorAll('#resultTable tbody tr').length, plotWidth:document.getElementById('coverage').getBoundingClientRect().width, exportEnabled:!document.getElementById('exportCsvBtn').disabled,status:document.getElementById('status').textContent})")
        report["screenshots"].append(await browser.screenshot("qa-analysis-results.png", 1440, 1000))
        await browser.js("document.getElementById('orbitTab').click();document.getElementById('analysisTab').click()")
        report["preservedResults"] = await browser.js("!document.getElementById('analysisResults').hidden && !document.getElementById('exportCsvBtn').disabled")
        await browser.js("document.getElementById('orbitTab').click();let e=document.getElementById('alt');e.value='888';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));")
        report["dirtyOrbit"] = await browser.js("({previewNotice:document.getElementById('previewNotice').textContent,previewBadge:document.getElementById('previewBadge').textContent,oldAltitude:document.getElementById('orbitAltitude').textContent,exportDisabled:document.getElementById('exportCsvBtn').disabled})")
        report["screenshots"].append(await browser.screenshot("qa-orbit-mobile.png", 390, 844, True))
        report["mobileOrbit"] = await browser.js("({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,title:document.getElementById('workspaceTitle').getBoundingClientRect().toJSON(),nav:document.getElementById('analysisTab').getBoundingClientRect().toJSON(),scene:document.querySelector('.viewer-wrap').getBoundingClientRect().toJSON()})")
        await browser.js("document.getElementById('analysisTab').click();scrollTo(0,0)")
        report["screenshots"].append(await browser.screenshot("qa-analysis-mobile.png", 390, 844, True))
        report["mobileAnalysis"] = await browser.js("({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,title:document.getElementById('workspaceTitle').getBoundingClientRect().toJSON()})")
    except Exception as exc:
        report["failure"] = repr(exc)
        report["screenshots"].append(await browser.screenshot("qa-failure.png", 1440, 1000))
    finally:
        report["requests"] = browser.requests()
        report["exceptions"] = [e for e in browser.events if e["method"] == "Runtime.exceptionThrown"]
        report["errorLogs"] = [e for e in browser.events if e["method"] == "Log.entryAdded" and e["params"]["entry"]["level"] == "error"]
        report["failedRequests"] = [e for e in browser.events if e["method"] == "Network.loadingFailed"]
        (OUT / "browser-qa-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=True, indent=2))
        await browser.ws.close()


if __name__ == "__main__":
    asyncio.run(main())

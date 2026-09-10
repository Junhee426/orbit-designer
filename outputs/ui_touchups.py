from pathlib import Path
p=Path('app/static/index.html')
s=p.read_text(encoding='utf-8')
s=s.replace("function renderServiceSummary(){const d=state.serviceSelection;if(!d)return;", "function renderServiceSummary(){const d=state.serviceSelection;if(!d)return;$('servicePending').hidden=true;")
s=s.replace("card.querySelector('.sh-remove').addEventListener", "card.querySelector('.sh-remove').addEventListener")
s=s.replace('>Remove</button>', '>삭제</button>').replace('>Altitude km</label>', '>고도 · km</label>').replace('>Inclination °</label>', '>경사각 · °</label>').replace('>Planes</label>', '>궤도면 수</label>').replace('>Sats / plane</label>', '>궤도면당 위성 수</label>')
s=s.replace("innerHTML='3D 지구에서 위성을 클릭하면 현재 시각의 위치·궤도 속성이 표시됩니다.'", "innerHTML='<div class=\"empty-icon\" aria-hidden=\"true\">⌖</div>지도의 위성을 클릭하세요.<br>위치, 속도, 궤도 속성을 확인할 수 있습니다.'")
for en,ko in [('Latitude','위도'),('Longitude','경도'),('Altitude','고도'),('Speed','속도'),('Inclination','경사각'),('Period','공전 주기'),('Plane / slot','궤도면 / 슬롯'),('Argument latitude','위도 인수')]:
    s=s.replace("prop('"+en+"',", "prop('"+ko+"',")
s=s.replace("if(!file)return;if(file.size", "if(!file)return;if(file.size")
s=s.replace("const GLOBAL_VIEW={lon:100,lat:20,height:30000000}", "const GLOBAL_VIEW={lon:100,lat:20,height:24000000}")
# Selected inputs, including unapplied country checks, are the scenario to save.
s=s.replace("country_codes:state.serviceSelection?.country_codes||selectedCountryCodes()", "country_codes:selectedCountryCodes()")
# Retain stale-result guidance in the empty state instead of only clearing numbers.
s=s.replace("$('analysisNotice').textContent='분석 대기 · 현재 설정으로 분석을 실행하세요.';", "$('analysisNotice').textContent='분석 대기 · 현재 설정으로 분석을 실행하세요.';")
p.write_text(s,encoding='utf-8')
p=Path('tests/test_ui_contract.py')
s=p.read_text(encoding='utf-8').replace('const GLOBAL_VIEW={lon:100,lat:20,height:30000000}','const GLOBAL_VIEW={lon:100,lat:20,height:24000000}')
p.write_text(s,encoding='utf-8')

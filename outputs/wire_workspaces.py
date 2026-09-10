from pathlib import Path
p=Path('app/static/index.html')
s=p.read_text(encoding='utf-8')
def replace(old,new):
    global s
    assert old in s,old[:100]
    s=s.replace(old,new)

replace('function setModeUI(){invalidateAnalysis();','function setModeUI(){invalidateAnalysis();invalidatePreview();')
replace("$('tradeBtn').disabled=m!=='walker';", "$('tradeBtn').disabled=state.analysisBusy||m!=='walker';")
replace('  state.snapshot=snap;', '  state.snapshot=snap;renderOrbitSummary(snap);')
replace("if(!quiet)setStatus('Updating Cesium scene…');", "if(!quiet)setStatus('궤도 배치를 적용하고 있습니다…');")
replace("if(!quiet)setStatus('3D snapshot updated.','good');", "if(!quiet)setStatus('궤도 배치를 적용했습니다. 위성을 선택하거나 시간을 이동해 확인하세요.','good');")
replace("font:{color:'#cbd9e8',size:10}", "font:{color:'#cbd9e8',size:12}")
replace("xaxis:{title:'Time (min)'", "xaxis:{title:{text:'시간 (min)'}")
replace("yaxis:{title:'Visible'", "yaxis:{title:{text:'가시 위성 수'}")
replace("function renderAnalysis(d){", "function renderAnalysis(d){showAnalysisResults();")
replace("?'mixed':", "?'주기 다양':")
replace("<th>Service point</th><th>Visibility</th><th>Avg visible</th><th>Handovers</th><th>Max outage</th>", "<th>관측 도시</th><th>가시 시간 비율</th><th>평균 가시 위성 수</th><th>위성 전환 / h</th><th>최대 단절시간</th>")
replace("$('tableTitle').textContent='Geometric visibility summary'", "$('tableTitle').textContent='도시별 가시성 결과'")
replace("setStatus('Running visibility analysis…');", "setStatus('가시성을 분석하고 있습니다…');")
replace("if(revision!==state.revision)return;renderAnalysis(d);recordAnalysis(d);configureTimeSlider();\n    const ok=await fetchSnapshot(0,true);if(revision!==state.revision)return;\n    if(ok)setStatus('Analysis complete. Geometric visibility only.','good');", "if(revision!==state.revision)return;renderAnalysis(d);recordAnalysis(d);\n    setStatus('가시성 분석을 완료했습니다. 그래프와 도시별 결과를 확인하세요.','good');")
replace("    const rows=d.results.map", "    showAnalysisResults(true);const rows=d.results.map")
replace("<th>#</th><th>Alt km</th><th>Inc</th><th>P×S</th><th>Worst visibility</th><th>Max outage</th><th>≥95%</th>", "<th>순위</th><th>고도 km</th><th>경사각</th><th>궤도면 × 위성</th><th>최저 가시 비율</th><th>최대 단절시간</th><th>95% 충족</th>")
replace("x.meets_availability?'Yes':'No'", "x.meets_availability?'충족':'미달'")
replace("`Candidate comparison · ${req.duration_min} min / ${req.step_sec} s · smallest qualifying constellation first`", "`후보 비교 · ${req.duration_min}분 / ${req.step_sec}초 간격 · 목표 충족 최소 위성군 우선`")
replace("setStatus('Comparing six candidate constellations…');", "setStatus('6개 위성군 후보를 비교하고 있습니다…');")
replace("setStatus('Comparison complete. Save JSON for per-city results and calculation conditions.','good')", "setStatus('후보 비교를 완료했습니다. JSON으로 도시별 상세 결과를 저장할 수 있습니다.','good')")
replace("textContent='▶ Play'", "textContent='▶ 재생'")
replace("textContent='Ⅱ Pause'", "textContent='Ⅱ 일시정지'")
replace("function setAnalysisBusy(busy){state.analysisBusy=busy;$('runBtn').disabled=busy;$('tradeBtn').disabled=busy||mode()!=='walker';}", "function setAnalysisBusy(busy){state.analysisBusy=busy;$('runBtn').disabled=busy;$('emptyRunBtn').disabled=busy;$('runBtn').textContent=busy?'분석 중…':'가시성 분석 실행';$('emptyRunBtn').textContent=busy?'분석 중…':'가시성 분석 실행';$('tradeBtn').disabled=busy||mode()!=='walker';$('analysisResults').setAttribute('aria-busy',String(busy));}")
replace("  $('resultTable').textContent='Inputs changed. Run analysis to refresh results.';", "  $('resultTable').textContent='';$('analysisResults').hidden=true;$('analysisEmpty').hidden=false;")
replace("  $('analysisNotice').textContent='Reanalysis required · geometric visibility only.';", "  $('analysisNotice').textContent='분석 대기 · 현재 설정으로 분석을 실행하세요.';")
replace("`V${m.app_version} · ${m.inputs.duration_min} min · ${m.inputs.step_sec} s · geometric visibility · ${m.input_sha256.slice(0,12)}`", "`${m.inputs.duration_min}분 분석 · ${m.inputs.step_sec}초 간격 · ${data.results?'후보 비교':'기하학적 가시성'}`")
replace("setStatus('Applying service countries / regions…');", "setStatus('서비스 지역을 적용하고 있습니다…');")
replace("setStatus('Service area applied. Run analysis to refresh metrics.','warn')", "setStatus('서비스 지역을 적용했습니다. 분석을 실행해 결과를 확인하세요.','good')")
replace("  if(!state.viewer)return;", "  if(!state.viewer)return;") if '  if(!state.viewer)return;' in s else None
replace("document.addEventListener('input',e=>{if(['alt','inc','planes','spp','phase','j2','dur','step','tleText','startUtc'].includes(e.target.id)||e.target.closest('.shell-card'))invalidateAnalysis();});", "document.addEventListener('input',e=>{const orbit=['alt','inc','planes','spp','phase','j2','tleText','startUtc'].includes(e.target.id)||e.target.closest('.shell-card');if(orbit||['dur','step'].includes(e.target.id))invalidateAnalysis();if(orbit)invalidatePreview();});")
replace("if(e.target.classList.contains('sh-remove'))invalidateAnalysis();});$('addShellBtn').addEventListener('click',invalidateAnalysis);", "if(e.target.classList.contains('sh-remove')){invalidateAnalysis();invalidatePreview();}});$('addShellBtn').addEventListener('click',()=>{invalidateAnalysis();invalidatePreview();});")
replace("setStatus('Scenario loaded. Run analysis to calculate results.','warn');", "$('heatResValue').textContent=`${$('heatRes').value}×${$('heatRes').value}`;await refreshPreview();setStatus('設定を読み込みました。'.replace('設定を読み込みました。','설정을 불러왔습니다. 상세 분석에서 새 결과를 계산하세요.'),'good');")
replace("setStatus('Scenario saved.','good');", "setStatus('설정을 JSON으로 저장했습니다.','good');")
old=s[s.index('async function bootstrap(){'):s.index('\nbootstrap();')]
new="""async function bootstrap(){
  initShells();bind();bindRelease();bindWorkspaces();configureTimeSlider();setModeUI();setWorkspace('orbit');$('tleText').value=verificationTLE;
  try{await loadServiceCatalog();await resolveServiceSelection();}catch(e){setStatus('서비스 지역을 불러오지 못했습니다: '+e.message,'warn');}
  try{await loadCesium();await initViewer();$('previewBtn').disabled=false;await refreshPreview();flyGlobal(true);}
  catch(e){console.error(e);$('viewerError').style.display='flex';$('viewerError').innerHTML=`<div><b>3D 지도를 불러오지 못했습니다.</b><br><br>${esc(e.message)}<br><br>네트워크 연결 또는 로컬 지도 자산을 확인한 뒤 새로고침하세요.</div>`;setStatus('3D 지도를 불러오지 못했습니다. 상세 분석은 계속 사용할 수 있습니다.','bad');}
}"""
replace(old,new)
# Keep Korean action labels readable; advanced orbital notation remains conventional.
replace("setStatus('設定を読み込みました。'.replace('設定を読み込みました。','설정을 불러왔습니다. 상세 분석에서 새 결과를 계산하세요.'),'good');", "setStatus('설정을 불러왔습니다. 상세 분석에서 새 결과를 계산하세요.','good');")
p.write_text(s,encoding='utf-8')

// Sample windows use the same left-hold intervals as the period analysis.
// The final sample closes the last interval and contributes no duration.
export function contactWindows(samples) {
  const windows=[];
  for(let i=0;i<samples.length-1;i++) {
    const sample=samples[i],startSec=sample.minutes*60,endSec=samples[i+1].minutes*60;
    if(!Number.isFinite(startSec)||!Number.isFinite(endSec)||endSec<=startSec) throw Error('시간 표본은 증가해야 합니다.');
    const state=sample.commPass?'connected':sample.commVisible>0?'below-target':'no-visibility';
    let window=windows.at(-1);
    if(!window||window.state!==state) {
      window={state,startSec,endSec,durationSec:0,meanRate:0,minRate:Infinity,minMargin:null,satellites:[]};
      windows.push(window);
    }
    const dt=endSec-startSec,rate=Number.isFinite(sample.rate)?sample.rate:0;
    window.meanRate=(window.meanRate*window.durationSec+rate*dt)/(window.durationSec+dt);
    window.durationSec+=dt;window.endSec=endSec;window.minRate=Math.min(window.minRate,rate);
    if(Number.isFinite(sample.margin))window.minMargin=window.minMargin===null?sample.margin:Math.min(window.minMargin,sample.margin);
    if(sample.bestId&&!window.satellites.includes(sample.bestId))window.satellites.push(sample.bestId);
  }
  return windows;
}

export function contactSummary(windows) {
  let connectedSec=0,longestConnectedSec=0,longestUnavailableSec=0,gap=0;
  for(const window of windows) {
    if(window.state==='connected') {
      connectedSec+=window.durationSec;longestConnectedSec=Math.max(longestConnectedSec,window.durationSec);gap=0;
    }else{gap+=window.durationSec;longestUnavailableSec=Math.max(longestUnavailableSec,gap);}
  }
  return {connectedSec,longestConnectedSec,longestUnavailableSec};
}

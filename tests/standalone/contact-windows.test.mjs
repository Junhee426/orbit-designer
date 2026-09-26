import test from 'node:test';
import assert from 'node:assert/strict';
import {contactWindows,contactSummary} from '../../standalone/contact-windows.js';
const sample=(seconds,commPass,commVisible,rate=0,bestId=null,margin=null)=>({minutes:seconds/60,commPass,commVisible,rate,bestId,margin});

test('contact windows merge handovers and weight partial intervals without counting the endpoint',()=>{
  const windows=contactWindows([sample(0,true,2,100,'A',4),sample(60,true,1,200,'B',2),sample(90,false,0)]);
  assert.equal(windows.length,1);
  assert.deepEqual(windows[0],{state:'connected',startSec:0,endSec:90,durationSec:90,meanRate:400/3,minRate:100,minMargin:2,satellites:['A','B']});
  assert.deepEqual(contactSummary(windows),{connectedSec:90,longestConnectedSec:90,longestUnavailableSec:0});
});

test('RF target failures and geometric outages remain distinct but form one continuous service interruption',()=>{
  const windows=contactWindows([sample(0,false,1,5,'A',-4),sample(60,false,0),sample(120,false,1,8,'B',-1),sample(150,true,1,100,'B',3),sample(210,true,1,100,'B',3)]);
  assert.deepEqual(windows.map(w=>w.state),['below-target','no-visibility','below-target','connected']);
  assert.deepEqual(contactSummary(windows),{connectedSec:60,longestConnectedSec:60,longestUnavailableSec:150});
  assert.equal(windows[1].minMargin,null);
  assert.equal(windows.reduce((sum,w)=>sum+w.durationSec,0),210);
});

test('empty, endpoint-only, full outage and malformed time series',()=>{
  assert.deepEqual(contactWindows([]),[]);
  assert.deepEqual(contactWindows([sample(0,true,1)]),[]);
  assert.deepEqual(contactSummary(contactWindows([sample(0,false,0),sample(30,false,0),sample(45,true,1)])),{connectedSec:0,longestConnectedSec:0,longestUnavailableSec:45});
  assert.throws(()=>contactWindows([sample(60,false,0),sample(0,false,0)]));
  assert.throws(()=>contactWindows([sample(0,false,0),sample(0,false,0)]));
});

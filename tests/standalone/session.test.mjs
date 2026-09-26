import test from 'node:test';
import assert from 'node:assert/strict';
import {SESSION_KEY,loadSession,saveSession} from '../../standalone/session.js';
const memory=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};
const validate=s=>{if(s?.valid!==true)throw Error('Invalid scenario');return s;};

test('session round trip and rejected edits preserve the last valid settings',()=>{
  const storage=memory();assert.equal(loadSession(storage,validate),null);
  saveSession(storage,{valid:true,name:'설계 A'},validate);
  assert.throws(()=>saveSession(storage,{valid:false},validate));
  assert.equal(loadSession(storage,validate).scenario.name,'설계 A');
});

test('unreadable, future and unavailable storage report failure without destroying data',()=>{
  const storage=memory();
  for(const raw of ['broken','null','{"version":2,"savedAt":1}','{"version":1,"savedAt":1,"scenario":{"valid":false}}']){
    storage.setItem(SESSION_KEY,raw);assert.throws(()=>loadSession(storage,validate));assert.equal(storage.getItem(SESSION_KEY),raw);
  }
  assert.throws(()=>saveSession({setItem(){throw Error('Quota exceeded');}},{valid:true},validate));
});

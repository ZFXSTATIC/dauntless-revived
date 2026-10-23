import test from 'node:test';
import assert from 'node:assert/strict';
import {AlertTracker, boxInfo, ALERT_AFTER_POLLS, RECOVER_AFTER_POLLS} from './gamestats.mjs';

const mk=(port,running,limit,cpu=50,blocked=false)=>boxInfo(port,{servers:[],capacity:{running,limit,cpu:{percent:cpu,blocked}}});
const down=port=>boxInfo(port,null);
const run=(t,infos,n,now0)=>{const out=[];for(let i=0;i<n;i++) out.push(...t.update(infos,now0+i*60000));return out;};

test('one server being full is not an alert', () => {
  const t=new AlertTracker();
  assert.equal(run(t,[mk(61041,30,30,60,true),mk(61042,2,16)],30,1e9).length,0);
});
test('every server being full for ten minutes alerts once for the whole fleet', () => {
  const t=new AlertTracker();
  const ev=run(t,[mk(61041,30,30),mk(61042,16,16)],ALERT_AFTER_POLLS+5,1e9);
  assert.deepEqual(ev.map(e=>e.type+':'+e.kind+':'+e.box.name),['alert:full:All servers']);
});
test('sustained CPU at 95 percent or more alerts, a short spike does not', () => {
  const t=new AlertTracker();
  assert.equal(run(t,[mk(61041,10,30,99)],ALERT_AFTER_POLLS-1,1e9).length,0);
  t.update([mk(61041,10,30,40)],2e9);
  assert.equal(run(t,[mk(61041,10,30,99)],ALERT_AFTER_POLLS-1,3e9).length,0);
  assert.deepEqual(run(t,[mk(61041,10,30,99)],1,4e9).map(e=>e.kind),['hot']);
});
test('a server that stops answering alerts after three polls and recovers after five good ones', () => {
  const t=new AlertTracker();
  assert.deepEqual(run(t,[down(61042),mk(61041,5,30)],3,1e9).map(e=>e.kind),['down']);
  const back=run(t,[mk(61042,1,16),mk(61041,5,30)],RECOVER_AFTER_POLLS,2e9);
  assert.deepEqual(back.map(e=>e.type),['recovered']);
});
test('a flapping server alerts at most once per hour', () => {
  const t=new AlertTracker(); let now=1e9, alerts=0;
  for(let cycle=0;cycle<5;cycle++) {
    alerts+=run(t,[down(61042)],4,now).filter(e=>e.type==='alert').length; now+=4*60000;
    run(t,[mk(61042,1,16)],RECOVER_AFTER_POLLS,now); now+=RECOVER_AFTER_POLLS*60000;
  }
  assert.equal(alerts,1);
});
test('no more than six messages go out in an hour', () => {
  const t=new AlertTracker(); const boxes=Array.from({length:10},(_,i)=>down(61100+i));
  assert.equal(run(t,boxes,5,1e9).length,6);
});

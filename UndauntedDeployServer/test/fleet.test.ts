import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FleetLock} from '../src/controllers/fleet';
const host=(running:number,limit:number|null=10,cpuBlocked=false)=>({running,pending:0,limit,cpuBlocked});
test('fleet locks at the high watermark and unlocks only below the low one',()=>{
 const lock=new FleetLock(90,75);
 assert.equal(lock.update([host(5),host(5)]).locked,false);
 assert.equal(lock.update([host(9),host(9)]).locked,true);
 assert.equal(lock.update([host(8),host(8)]).locked,true);
 const open=lock.update([host(7),host(7)]);
 assert.equal(open.locked,false);assert.equal(open.free,6);
});
test('an unreadable host adds no capacity, and no readable host keeps the lock',()=>{
 const lock=new FleetLock();
 assert.equal(lock.update([null,null]).locked,true);
 const partial=lock.update([host(1),null]);
 assert.equal(partial.limit,10);assert.equal(partial.reachable,1);
});
test('fleet locks when every reachable host is CPU blocked',()=>{
 const lock=new FleetLock();
 assert.equal(lock.update([host(1,10,true),host(1,10,true)]).locked,true);
 assert.equal(lock.update([host(1,10,true),host(1,10,false)]).locked,false);
 assert.equal(lock.update([host(1),host(1)]).locked,false);
});
test('without a hunt limit only CPU locks the fleet, and it unlocks again',()=>{
 const lock=new FleetLock();
 assert.equal(lock.update([host(50,null,true)]).locked,true);
 const open=lock.update([host(50,null,false)]);
 assert.equal(open.locked,false);assert.equal(open.limit,null);assert.equal(open.free,null);
});
test('invalid thresholds are rejected',()=>assert.throws(()=>new FleetLock(70,80),/Invalid/));

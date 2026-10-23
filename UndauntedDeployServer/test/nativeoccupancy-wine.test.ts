import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AssignWinePids} from '../src/controllers/nativeoccupancy';

const server=(pid:number,startedAt:number)=>({pid,startedAt});
const file=(winePid:number,bornAt:number)=>({winePid,bornAt});

test('a game is matched to the log created just after it started',()=>{
 const got=AssignWinePids([server(100,1000),server(101,11000)],[file(812,9000+1000),file(1536,18000)],new Set());
 assert.equal(got.get(100),812);
 assert.equal(got.get(101),1536);
});
test('logs from before the game started, or already claimed, are never used',()=>{
 const got=AssignWinePids([server(100,50000)],[file(5,1000),file(6,60000)],new Set([6]));
 assert.equal(got.size,0);
});
test('a log created long after the start does not belong to the game',()=>{
 assert.equal(AssignWinePids([server(100,0)],[file(7,10*60000)],new Set()).size,0);
});
test('two games started together are matched in start order',()=>{
 const got=AssignWinePids([server(200,5000),server(201,5100)],[file(30,6000),file(31,6100)],new Set());
 assert.equal(got.get(200),30);
 assert.equal(got.get(201),31);
});

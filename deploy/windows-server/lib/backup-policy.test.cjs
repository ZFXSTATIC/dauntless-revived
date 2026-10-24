const {test} = require('node:test');
const assert = require('node:assert/strict');
const {backupProgress} = require('./backup-policy.cjs');
test('backup completes steady progress, even when the database grows',()=>{
    const progress=backupProgress();
    for(const remainingPages of [1000,900,800,700,0]) assert.equal(progress({remainingPages}),100);
});
test('live write restarts are bounded',()=>{
    const progress=backupProgress();
    for(const remainingPages of [1000,900,1000,800,1000,700]) progress({remainingPages});
    assert.throws(()=>progress({remainingPages:1000}),/repeatedly restarted/);
});
test('no progress still reaches a deadline',()=>{
    let clock=0;const progress=backupProgress({now:()=>clock,timeoutMs:100});
    progress({remainingPages:1000});clock=100;
    assert.throws(()=>progress({remainingPages:1000}),/deadline/);
});

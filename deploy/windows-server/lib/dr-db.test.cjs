const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {postJson} = require('./dr-db.js');
test('a slow live backup answer is waited for, and the request is sent as json',async()=>{
    let seen;
    const server=http.createServer((req,res)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{seen={key:req.headers['x-k'],b};setTimeout(()=>res.end('{"copied":true}'),1500);});});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    try{
        const r=await postJson(`http://127.0.0.1:${server.address().port}/internal/backup`,{'content-type':'application/json','x-k':'k'},{name:'n'},10000);
        assert.deepEqual(r,{ok:true,status:200});
        assert.deepEqual(seen,{key:'k',b:'{"name":"n"}'});
    }finally{server.close();}
});
test('a non-2xx answer is reported, a silent server times out, a stopped metagame is ECONNREFUSED',async()=>{
    const hang=http.createServer((req,res)=>{});
    const bad=http.createServer((req,res)=>{res.statusCode=500;res.end();});
    await new Promise(r=>hang.listen(0,'127.0.0.1',r));
    await new Promise(r=>bad.listen(0,'127.0.0.1',r));
    try{
        assert.deepEqual(await postJson(`http://127.0.0.1:${bad.address().port}/`,{}, {}, 5000),{ok:false,status:500});
        await assert.rejects(postJson(`http://127.0.0.1:${hang.address().port}/`,{}, {}, 300),{code:'ETIMEDOUT'});
        const port=hang.address().port;hang.closeAllConnections();hang.close();
        await assert.rejects(postJson(`http://127.0.0.1:${port}/`,{}, {}, 5000),{code:'ECONNREFUSED'});
    }finally{bad.close();hang.close();}
});

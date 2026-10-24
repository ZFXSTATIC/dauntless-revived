const finite = value => Number.isFinite(value) && value >= 0 ? value : null;
const fresh = (at, limit, now) => Number.isFinite(Date.parse(at)) && now-Date.parse(at) <= limit && Date.parse(at) <= now+60000;
const count = value => Number.isInteger(value) && value >= 0 ? value : null;
export function validCapacity(sample, now = Date.now()) {
  const value=sample?.capacity;
  if(!value || !fresh(sample.capacitySampleAt,30000,now) || ['running','pending','limit'].some(key=>count(value[key])===null))return null;
  const percent=value.cpu?.percent, limit=value.cpu?.limit, resume=value.cpu?.resume;
  const cpu=value.cpu && typeof value.cpu.blocked==='boolean' && [percent,limit,resume].every(n=>finite(n)!==null && n<=100)
    ? {blocked:value.cpu.blocked,percent,limit,resume} : null;
  return {running:value.running,pending:value.pending,limit:value.limit,cpu};
}
export function fleetSummary(main, worker, mainError = null, now = Date.now(), aus = null, germany = null, eu2 = null) {
  const mainOnline = !!main && !mainError && fresh(main.at,30000,now);
  const perf = main?.performance;
  const mainCapacity=mainOnline ? validCapacity(main,now) : null;
  const mainHunts = mainCapacity?.running ?? (mainOnline && perf && !perf.stale && fresh(perf.at,150000,now) && Array.isArray(perf.processes) ? perf.processes.filter(p=>p.role==='hunt' || p.role==='tutorial').length : null);
  const row = (name, online, sample, hunts, huntSampleAt) => ({name,online,at:sample?.at ?? null,huntSampleAt,
    cpu:online ? finite(sample.cpu) : null, logicalCpus:sample?.logicalCpus ?? null,
    ramUsedMB:online ? finite(sample.ramUsedMB) : null,ramTotalMB:online ? finite(sample.ramTotalMB) : null,hunts:online ? hunts : null,
    capacity:online ? validCapacity(sample,now) : null,capacitySampleAt:sample?.capacitySampleAt ?? null,
    diskFreeGB:online ? finite(sample.diskFreeGB) : null,hostUptimeSeconds:online ? finite(sample.hostUptimeSeconds) : null});
  const rows = [row('Server #1 · EU',mainOnline,main,mainHunts,mainCapacity ? main.capacitySampleAt : perf?.at ?? null)];
  for (const [name,node] of [['Server #2 · Key bot',worker],['Server #3 · US (NA)',aus],['Server #4 · Germany',germany],['Server #5 · EU overflow',eu2]]) {
    if(!node?.configured)continue;
    const online = node.online && !!node.sample && fresh(node.sample.at,30000,now);
    const capacity=online ? validCapacity(node.sample,now) : null;
    const hunts=capacity?.running ?? (node.sample?.services?.deploy !== false && Array.isArray(node.sample?.hunts) ? node.sample.hunts.filter(h=>!['city','dojo'].includes(h.kind)).length : name==='Server #2 · Key bot' ? 0 : null);
    rows.push(row(name,online,node.sample,hunts,capacity ? node.sample.capacitySampleAt : node.sample?.at ?? null));
  }
  const sum = field => rows.every(r=>r[field] !== null) ? rows.reduce((n,r)=>n+r[field],0) : null;
  const cpu = sum('cpu'), ramUsedMB=sum('ramUsedMB'),ramTotalMB=sum('ramTotalMB');
  return {rows,totals:{servers:rows.length,online:rows.filter(r=>r.online).length,
    meanCpu:cpu===null?null:cpu/rows.length,ramUsedMB,ramTotalMB,
    ramPercent:ramUsedMB!==null && ramTotalMB>0 ? ramUsedMB/ramTotalMB*100:null,hunts:sum('hunts')}};
}

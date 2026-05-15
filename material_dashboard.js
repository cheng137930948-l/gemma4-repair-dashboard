// ═══════════════════════════════════════════════════
//   Chrome Extension Mode — 直连 EIP，无需代理
// ═══════════════════════════════════════════════════

/* ── 库检测 ── */
async function _ensureLibs(){
  if(typeof XLSX === 'undefined'){
    console.warn('[MRO] XLSX 未加载，Excel 将自动降级为 CSV 导出。请确认 libs/xlsx.full.min.js 存在。');
  }
}

const EIP_BASE     = '';
const EIP_DATA_URL = '';
const EIP_ORG_ID   = '111';
const EIP_LOCATION = 'DEMO_LOCATION';

/* 检查是否已登入 EIP（通过扩展后台读取 cookie） */
function getEipCookie(){
  return new Promise(resolve => {
    try{
      chrome.runtime.sendMessage({action:'getEipCookie'}, resp => {
        if(chrome.runtime.lastError){ resolve({ok:false}); return; }
        resolve(resp || {ok:false});
      });
    }catch(e){ resolve({ok:false}); }
  });
}

/* 打开 EIP 登入页 */
function openEipLogin(){
  try{
    chrome.runtime.sendMessage({action:'openEip'});
  }catch(e){
    window.open(EIP_BASE + '/login', '_blank');
  }
}

/* 显示/隐藏 EIP 未登入警告 */
function showEipWarning(title, sub){
  const el = document.getElementById('eipLoginWarning');
  if(!el) return;
  const titleEl = document.getElementById('eipWarnTitle');
  const subEl = document.getElementById('eipWarnSub');
  if(titleEl) titleEl.textContent = title || '请先登入 EIP';
  if(subEl) subEl.textContent = sub || '登入后看板将自动获取实时数据';
  el.style.display = 'flex';
}
function hideEipWarning(){
  const el = document.getElementById('eipLoginWarning');
  if(el) el.style.display = 'none';
}

let allData=[], filteredData=[];
let apiTotal=0;
let sortField='create_date', sortDir='desc';
let currentPage=1;
let charts={};
let _overtimeItems=[];

/* ─ helpers ─ */
function $(id){
  return document.getElementById(id);
}
function safeGetLocalStorage(key, fallback=''){
  try{
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value;
  }catch(e){
    return fallback;
  }
}
function safeSetLocalStorage(key, value){
  try{
    window.localStorage.setItem(key, String(value));
    return true;
  }catch(e){
    console.warn('[storage] set failed:', key, e);
    return false;
  }
}
function safeGet(key, fallback=''){return safeGetLocalStorage(key, fallback);}
function safeSet(key, value){return safeSetLocalStorage(key, value);}
function safeGetJsonLocalStorage(key, fallback){
  const raw = safeGetLocalStorage(key, null);
  if(raw === null) return fallback;
  try{return JSON.parse(raw);}catch(e){return fallback;}
}
function formatExportStamp(date=new Date()){
  const pad=n=>String(n).padStart(2,'0');
  return `${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
function downloadBlob(filename, content, mimeType){
  try{
    const blob=new Blob([content],{type:mimeType});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=filename;
    a.style.display='none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    console.log('[export] download triggered', filename);
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    return true;
  }catch(err){
    console.error('[export] download failed', err);
    try{alert('导出下载失败：'+(err&&err.message?err.message:String(err)));}catch(_){}
    return false;
  }
}
function downloadCsv(filename, rows){
  const csvRows=rows.map(r=>r.map(c=>'"'+String(c??'').replace(/"/g,'""')+'"').join(','));
  return downloadBlob(filename,'\uFEFF'+csvRows.join('\n'),'text/csv;charset=utf-8');
}

function toast(msg,type='info',ms=4500){
  const el=document.getElementById('toast');
  if(!el) return;
  el.className=`toast ${type}`;
  el.innerHTML={'ok':'✅','err':'❌','info':'ℹ️'}[type]+' '+msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t=setTimeout(()=>el.classList.remove('show'),ms);
}
function showLoading(txt,pct=0,detail=''){
  document.getElementById('loadingOverlay').classList.add('show');
  document.getElementById('loadingText').textContent=txt;
  document.getElementById('progressFill').style.width=pct+'%';
  document.getElementById('loadingDetail').textContent=detail;
}
function setProgress(pct,txt,detail=''){
  document.getElementById('progressFill').style.width=pct+'%';
  if(txt) document.getElementById('loadingText').textContent=txt;
  document.getElementById('loadingDetail').textContent=detail;
}
function hideLoading(){document.getElementById('loadingOverlay').classList.remove('show');}
function setStatus(type,txt){
  const c={ok:'#00d4aa',err:'#ff4560',wait:'#ffc53d'};
  document.getElementById('statusDot').style.background=c[type]||c.wait;
  document.getElementById('statusText').textContent=txt;
}

/* ═══════════════════════════════════════
   FETCH DATA
═══════════════════════════════════════ */
/* sendMsg：向 background.js 发消息（所有跨域请求都走这里） */
function sendMsg(msg){
  return new Promise((resolve)=>{
    // 演示版不支持扩展消息，直接返回错误触发演示模式
    setTimeout(() => resolve({ok:false, error:'DEMO_MODE'}), 100);
  });
}

async function fetchData(reset=false){
  if(reset) allData=[];
  showLoading('初始化 Gemma 4 Demo 数据...',5);
  console.log('[MRO] fetchData started (Hackathon Demo Mode)');

  // 演示版直接进入 Demo 模式，不执行真实权限检查
  setTimeout(() => {
    hideEipWarning();
    setStatus('ok','已连接 Gemma 4 演示引擎');
    const apiStatusEl = document.getElementById('apiStatus');
    if(apiStatusEl) apiStatusEl.innerHTML='<span style="color:#00d4aa">🟢 Demo Mode Active</span>';
    const badge = document.getElementById('eipUserBadge');
    if(badge){ badge.textContent='🟢 Hackathon Demo'; badge.style.display=''; }

    useDemo();
    toast('✅ 已加载 Gemma 4 脱敏演示数据','ok');

    // 更新最后更新时间
    const lastUpdateEl = document.getElementById('lastUpdate');
    if(lastUpdateEl) lastUpdateEl.textContent = new Date().toLocaleString('zh-CN') + ' (Demo)';

    hideLoading();
  }, 800);
}

/* ─ 日期/时间自动探测 ─ */
const DATE_RE=/^\d{4}[-\/]\d{2}[-\/]\d{2}/;
const DT_RE=/^\d{4}[-\/]\d{2}[-\/]\d{2}[T ]\d{2}:\d{2}/;
function autoDate(r){
  const known=['create_date','建立日期','建立时间','创建日期','创建时间','单据日期','发料日期','退料日期','日期','date','createDate','issueDate','created_at','issue_date','receive_date','doc_date','trans_date'];
  for(const k of known){const v=r[k];if(v&&DATE_RE.test(String(v)))return String(v).slice(0,10);}
  for(const[k,v] of Object.entries(r)){if(v&&typeof v==='string'&&DATE_RE.test(v))return v.slice(0,10);}
  return '';
}
function autoDateTime(raw){
  // Try datetime fields first
  const knownDT=['create_datetime','created_at','issue_datetime','doc_datetime','create_date','建立日期','建立时间'];
  for(const k of knownDT){
    const v=raw[k];
    if(v&&DT_RE.test(String(v))){
      try{return new Date(String(v).replace(' ','T'));}catch(e){}
    }
  }
  // Scan all
  for(const[k,v] of Object.entries(raw)){
    if(v&&typeof v==='string'&&DT_RE.test(v)){
      try{return new Date(v.replace(' ','T'));}catch(e){}
    }
  }
  // Fall back to date only
  const d=autoDate(raw);
  return d?new Date(d):null;
}

let _debugLogged=false;
function mapRow(r){
  if(!_debugLogged){
    console.log('[MRO-DEBUG] API 原始字段名:', Object.keys(r));
    console.log('[MRO-DEBUG] 第一行完整数据:', JSON.stringify(r).slice(0,2000));
    _debugLogged=true;
  }
  const get=(...keys)=>{for(const k of keys){if(r[k]!==undefined&&r[k]!==null&&r[k]!=='')return String(r[k]);}return '';};
  const dateVal=autoDate(r);
  const dt=autoDateTime(r);
  return {
    '单号':               get('单号','id','docNo','doc_no','order_no','单据号'),
    'receive_return_type':get('receive_return_type','领退类型','领退种类','type','issueType','move_type','种类','类别','线别分类','线别'),
    'job_name':           get('job_name','工单号','工单','workOrder','work_order','wo_no','job_no'),
    'location_name':      get('location_name','站别','工序','工站','站点','location','station','组织'),
    'part':               get('part','料号','partNo','part_no','materialCode','pn','物料编号'),
    'part_name':          get('part_name','品名','品名规格','规格','spec','specification','description','物料名称','摘文'),
    'create_user_name':   get('创建人员','create_user_name','建立人','建立者','创建人','create_user','操作员'),
    'create_date':        dateVal,
    '_datetime':          dt,
    'operator':           get('operator','操作人','经手人','handler','responsible','领退人','创建人'),
    'status':             get('单据状态','status','state'),
    'dept':               get('部门','department','dept'),
    _raw: r,
  };
}

/* ─ 本地筛选 ─ */
function applyLocalFilter(){
  const type=document.getElementById('filterType').value;
  const station=document.getElementById('filterStation').value;
  const opRaw=(document.getElementById('filterOperator')||{}).value||'';
  const op=opRaw.trim().toLowerCase();
  filteredData=allData.filter(r=>{
    if(type&&r['receive_return_type']!==type) return false;
    if(station&&r['location_name']!==station) return false;
    if(op){
      const name=(r['create_user_name']||'').toLowerCase();
      const opName=(r['operator']||'').toLowerCase();
      const raw=r._raw||{};
      // 也匹配原始行里的英文账号字段
      const rawName=Object.values(raw).map(v=>String(v||'').toLowerCase()).join(' ');
      if(!name.includes(op)&&!opName.includes(op)&&!rawName.includes(op)) return false;
    }
    return true;
  });
}
function useDemo(){
  allData=[...DEMO];filteredData=[...DEMO];apiTotal=DEMO.length;
  updateAll();
  document.getElementById('lastUpdate').textContent=new Date().toLocaleString('zh-CN')+'（演示）';
  document.getElementById('totalInfo').textContent='演示模式 '+DEMO.length+' 条';
  hideLoading();
}

/* ═══════════════════════════════════════
   UPDATE ALL
═══════════════════════════════════════ */
function updateAll(){
  currentPage=1;
  updateKPIs();
  updateCharts();
  updateTop10();
  renderTable();
  checkOvertimeAndRender();
  try{ rdcPushToIntegration(); }catch(_){ }
}

/* ═══════════════════════════════════════
   RDC 集成桥接 —— 向「维修数据中心」集成看板推送本地 allData
   路径 ① 父 iframe：parent.postMessage RDC_EXT_DATA
   路径 ② 兄弟标签页：BroadcastChannel('RDC_EXT_DATA_BUS')
   路径 ③ 降级兜底：localStorage 快照 + storage 事件
═══════════════════════════════════════ */
let __rdcBus=null;
try{ __rdcBus = new BroadcastChannel('RDC_EXT_DATA_BUS'); }catch(_){}
function rdcPushToIntegration(){
  const rows = Array.isArray(allData) ? allData : [];
  if(!rows.length) return;
  const payload = {
    type:'RDC_EXT_DATA',
    source:'mro_line_issue_return',
    label:'产线维修领退料分析看板',
    data: rows,
    ts: Date.now()
  };
  try{ if(window.parent && window.parent!==window) window.parent.postMessage(payload,'*'); }catch(_){}
  try{ if(window.top && window.top!==window && window.top!==window.parent) window.top.postMessage(payload,'*'); }catch(_){}
  try{ if(__rdcBus) __rdcBus.postMessage(payload); }catch(_){}
  safeSetLocalStorage('RDC_EXT_DATA__mro_line_issue_return', JSON.stringify(payload));
}
/* 周期性兜底推送（60s），防止集成侧未监听到首次消息 */
setInterval(()=>{ try{ rdcPushToIntegration(); }catch(_){ } }, 60000);
/* 集成侧主动请求快照时回应 */
window.addEventListener('message', (evt)=>{
  if(evt && evt.data && evt.data.type==='RDC_EXT_SNAPSHOT_REQUEST'){
    try{ rdcPushToIntegration(); }catch(_){}
  }
});

function updateKPIs(){
  const d=filteredData,tot=d.length;
  const iss=d.filter(r=>r['receive_return_type']==='领料').length;
  const ret=d.filter(r=>r['receive_return_type']==='退料').length;
  animN('kpi-total',tot);animN('kpi-issue',iss);animN('kpi-return',ret);
  animN('kpi-parts',new Set(d.map(r=>r['part'])).size);
  animN('kpi-workorders',new Set(d.map(r=>r['job_name'])).size);
  document.getElementById('kpi-total-sub').textContent=`共 ${apiTotal} 条 / 已拉 ${tot}`;
  document.getElementById('kpi-issue-pct').textContent=tot?`占比 ${Math.round(iss/tot*100)}%`:'—';
  document.getElementById('kpi-return-pct').textContent=tot?`占比 ${Math.round(ret/tot*100)}%`:'—';
}
function animN(id,target){
  const el=document.getElementById(id),s=parseInt(el.textContent)||0,t0=performance.now();
  const step=now=>{const t=Math.min((now-t0)/600,1);el.textContent=Math.round(s+(target-s)*(1-Math.pow(1-t,3)));if(t<1)requestAnimationFrame(step);};
  requestAnimationFrame(step);
}

/* ── Charts（纯 CSS/HTML，零外部依赖）── */
function updateCharts(){bStation();bPie();bTrend();}

function bStation(){
  const c=document.getElementById('chartStation');if(!c)return;
  const el=c.parentElement;
  const sta=[...new Set(filteredData.map(r=>r['location_name']))].filter(Boolean).sort();
  if(!sta.length){el.innerHTML='<div style="color:var(--text3);padding:40px;text-align:center">暂无数据</div>';return;}
  const maxVal=Math.max(...sta.map(s=>filteredData.filter(r=>r['location_name']===s).length),1);
  let html='<div class="viz-legend"><span><i style="background:#00d4aa;color:#00d4aa"></i>领料</span><span><i style="background:#ff4560;color:#ff4560"></i>退料</span></div><div class="station-grid">';
  sta.forEach((s,idx)=>{
    const iss=filteredData.filter(r=>r['location_name']===s&&r['receive_return_type']==='领料').length;
    const ret=filteredData.filter(r=>r['location_name']===s&&r['receive_return_type']==='退料').length;
    const pI=maxVal?Math.max(6,Math.round(iss/maxVal*100)):0, pR=maxVal?Math.max(6,Math.round(ret/maxVal*100)):0;
    html+=`<div class="station-row">
      <div class="station-label" title="${s}">${s}</div>
      <div class="station-pair">
        <div class="station-track"><div class="station-fill issue" style="width:${iss?pI:0}%;animation-delay:${idx*60}ms"></div></div>
        <div class="station-track"><div class="station-fill return" style="width:${ret?pR:0}%;animation-delay:${idx*60+80}ms"></div></div>
      </div>
      <div class="station-val">${iss}/${ret}</div>
    </div>`;
  });
  html+='</div>';
  el.innerHTML=html;
}

function bPie(){
  const c=document.getElementById('chartPie');if(!c)return;
  const el=c.parentElement;
  const iss=filteredData.filter(r=>r['receive_return_type']==='领料').length;
  const ret=filteredData.filter(r=>r['receive_return_type']==='退料').length;
  const tot=iss+ret;
  if(!tot){el.innerHTML='<div style="color:var(--text3);padding:40px;text-align:center">暂无数据</div>';return;}
  const pctI=Math.round(iss/tot*100), pctR=100-pctI;
  el.innerHTML=`<div class="pie-tech">
    <div class="pie-radar">
      <div class="pie-donut" style="background:conic-gradient(#00d4aa 0% ${pctI}%, #ff4560 ${pctI}% 100%)"><div class="pie-core">${tot}</div></div>
    </div>
    <div class="pie-legend">
      <div class="pie-item" style="color:#00d4aa"><span class="pie-sw" style="background:#00d4aa"></span><span>领料 <strong>${iss}</strong> / ${pctI}%</span></div>
      <div class="pie-item" style="color:#ff4560"><span class="pie-sw" style="background:#ff4560"></span><span>退料 <strong>${ret}</strong> / ${pctR}%</span></div>
    </div>
  </div>`;
}

function bTrend(){
  const c=document.getElementById('chartTrend');if(!c)return;
  const el=c.parentElement;
  const mo={};
  filteredData.forEach(r=>{
    const dateStr=r['create_date']||autoDate(r._raw||{});
    const m=dateStr?String(dateStr).slice(0,7):'';
    if(m&&m.length===7&&/^\d{4}-\d{2}/.test(m)){
      if(!mo[m])mo[m]={i:0,r:0};
      r['receive_return_type']==='领料'?mo[m].i++:mo[m].r++;
    }
  });
  const labs=Object.keys(mo).sort();
  if(!labs.length){el.innerHTML='<div style="color:var(--text3);padding:40px;text-align:center">暂无日期数据</div>';return;}
  const maxVal=Math.max(...labs.map(l=>Math.max(mo[l].i,mo[l].r)),1);
  let html='<div class="viz-legend"><span><i style="background:#00d4aa;color:#00d4aa"></i>领料</span><span><i style="background:#ff4560;color:#ff4560"></i>退料</span></div><div class="trend-canvas">';
  labs.forEach((l,idx)=>{
    const hI=maxVal?Math.max(8,Math.round(mo[l].i/maxVal*126)):0, hR=maxVal?Math.max(8,Math.round(mo[l].r/maxVal*126)):0;
    html+=`<div class="trend-col">
      <div class="trend-bars">
        <div class="trend-bar issue" style="height:${mo[l].i?hI:0}px;animation-delay:${idx*70}ms" title="领料 ${mo[l].i}"></div>
        <div class="trend-bar return" style="height:${mo[l].r?hR:0}px;animation-delay:${idx*70+80}ms" title="退料 ${mo[l].r}"></div>
      </div>
      <div class="trend-val">${mo[l].i}/${mo[l].r}</div>
      <div class="trend-month">${l.slice(5)}月</div>
    </div>`;
  });
  html+='</div>';
  el.innerHTML=html;
}

/* ═══════════════════════════════════════
   TOP 10
═══════════════════════════════════════ */
function topN(arr,keyFn,n=10){
  const cnt={};
  arr.forEach(r=>{const k=keyFn(r);if(k){cnt[k]=(cnt[k]||0)+1;}});
  return Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,n);
}

function _cssHBar(items, color){
  if(!items.length) return '<div style="color:var(--text3);padding:20px;text-align:center;font-size:11px;">暂无数据</div>';
  const maxVal=Math.max(...items.map(x=>x[1]),1);
  const tone=color==='#00d4aa'?'cyan':color==='#ff4560'?'red':color==='#ffc53d'?'yellow':'blue';
  return `<div class="hbar-grid">${items.map(([label,v],idx)=>{
    const pct=maxVal?Math.max(6,Math.round(v/maxVal*100)):0;
    return `<div class="hbar-row">
      <div class="hbar-name" title="${label}">${label.length>18?label.slice(0,16)+'…':label}</div>
      <div class="hbar-track"><div class="hbar-fill ${tone}" style="width:${v?pct:0}%;animation-delay:${idx*60}ms"></div></div>
      <div class="hbar-value">${v}</div>
    </div>`;
  }).join('')}</div>`;
}

function buildHBar(canvasId,chartKey,labels,values,color){
  const canvas=document.getElementById(canvasId);
  if(!canvas)return;
  const el=canvas.parentElement;
  const items=labels.map((l,i)=>[l,values[i]]);
  el.innerHTML=_cssHBar(items, color);
}

function updateTop10(){
  const d=filteredData;
  const issues=d.filter(r=>r['receive_return_type']==='领料');
  const returns=d.filter(r=>r['receive_return_type']==='退料');

  const top10Issue=topN(issues,r=>r['part']);
  buildHBar('chartTop10Issue','t10i',top10Issue.map(x=>x[0]),top10Issue.map(x=>x[1]),'#00d4aa');

  const top10Return=topN(returns,r=>r['part']);
  buildHBar('chartTop10Return','t10r',top10Return.map(x=>x[0]),top10Return.map(x=>x[1]),'#ff4560');

  const top10Part=topN(d,r=>r['part']);
  buildHBar('chartTop10Part','t10p',top10Part.map(x=>x[0]),top10Part.map(x=>x[1]),'#3d8bff');

  const top10WO=topN(d,r=>r['job_name']);
  buildHBar('chartTop10WO','t10w',top10WO.map(x=>x[0]),top10WO.map(x=>x[1]),'#ffc53d');
}

/* ═══════════════════════════════════════
   超时预警
═══════════════════════════════════════ */
function checkOvertimeAndRender(){
  const now=new Date();
  const thresholdHours=Math.max(1, Number(safeGetLocalStorage('mro_alert_threshold_hours','3')) || 3);
  const THREE_H=thresholdHours*60*60*1000;

  // 有退料的工单（用 job_name 匹配）
  const returnedJobs=new Set(
    allData.filter(r=>r['receive_return_type']==='退料').map(r=>r['job_name']).filter(Boolean)
  );

  _overtimeItems=allData.filter(r=>{
    if(r['receive_return_type']!=='领料') return false;
    if(r['job_name']&&returnedJobs.has(r['job_name'])) return false; // 已有退料

    const dt=r['_datetime'];
    if(dt&&!isNaN(dt)){
      return (now-dt)>THREE_H;
    } else {
      // 无精确时间：只标记日期比今天早的（昨天及以前的领料未退料）
      if(!r['create_date']) return false;
      const d=new Date(r['create_date']); d.setHours(23,59,59,0);
      return d<now&&(now-d)>THREE_H;
    }
  });

  // 计算超时时长
  _overtimeItems=_overtimeItems.map(r=>{
    const dt=r['_datetime'];
    let hours='未知';
    if(dt&&!isNaN(dt)){
      const h=Math.floor((now-dt)/3600000);
      hours=h+'小时';
    } else if(r['create_date']){
      const d=new Date(r['create_date']);
      const h=Math.floor((now-d)/3600000);
      hours=h+'小时';
    }
    return {...r,_overtimeHours:hours,_alertStatus:`领料超${thresholdHours}小时未退料`};
  });

  const panel=document.getElementById('alertPanel');
  const list=document.getElementById('alertList');
  document.getElementById('alertCount').textContent=`${_overtimeItems.length} 条`;
  const alertTitle=document.querySelector('.alert-title');
  if(alertTitle && alertTitle.firstChild){
    alertTitle.firstChild.textContent=`⚠️ 领料超${thresholdHours}小时未退料预警 `;
  }

  if(!_overtimeItems.length){
    panel.classList.remove('show');
    return;
  }

  panel.classList.add('show');
  list.innerHTML=_overtimeItems.map(r=>`
    <div class="alert-item">
      <div class="alert-item-top">
        <span class="alert-job">工单：${r['job_name']||'—'}</span>
        <span class="alert-time">⏱ ${r._overtimeHours}</span>
      </div>
      <div class="alert-detail">料号：${r['part']||'—'} &nbsp;|&nbsp; 站别：${r['location_name']||'—'} &nbsp;|&nbsp; 单号：${r['单号']||'—'} &nbsp;|&nbsp; 操作人：${r['create_user_name']||'—'}</div>
    </div>`).join('');
}

/* ═══════════════════════════════════════
   员工账号配置（localStorage）
═══════════════════════════════════════ */
const CFG_KEY='mro_user_map';
function normalizeUserMap(arr){
  return (Array.isArray(arr)?arr:[]).map(u=>({
    name:String(u?.name||'').trim(),
    email:String(u?.email||'').trim()
  })).filter(u=>u.name||u.email);
}
function loadUserMap(){
  return normalizeUserMap(safeGetJsonLocalStorage(CFG_KEY, []));
}
function saveUserMap(arr){
  return safeSetLocalStorage(CFG_KEY, JSON.stringify(normalizeUserMap(arr)));
}
function getUserEmail(name){
  if(!name) return '';
  const map=loadUserMap();
  const n=name.trim().toLowerCase();
  // 1. 精确匹配
  const exact=map.find(u=>u.name.trim().toLowerCase()===n);
  if(exact) return exact.email;
  // 2. 用邮箱前缀匹配（XUEHOU → xuehou@... → 侯雪）
  const byEmail=map.find(u=>{
    const prefix=u.email.split('@')[0].toLowerCase();
    return prefix===n||n===prefix;
  });
  if(byEmail) return byEmail.email;
  // 3. 邮箱前缀包含匹配（MINSUN → minsun 包含在 mingtaisun 里）
  const fuzzy=map.find(u=>{
    const prefix=u.email.split('@')[0].toLowerCase();
    return prefix.includes(n)||n.includes(prefix);
  });
  return fuzzy?fuzzy.email:'';
}

function openSystemSettings() { openCfg(); }

function openCfg(){
  console.log('[settings] open panel');
  _cfgBuf = loadUserMap();
  renderCfgRows();
  if($('cfgWebhookInput')) $('cfgWebhookInput').value = safeGetLocalStorage('mro_teams_webhook','');
  if($('cfgWechatInput'))  $('cfgWechatInput').value  = safeGetLocalStorage('mro_wechat_webhook','');
  if($('cfgFormsInput'))   $('cfgFormsInput').value   = safeGetLocalStorage('mro_forms_link','');
  if($('cfgDemoMode'))     $('cfgDemoMode').checked   = safeGetLocalStorage('mro_push_demo_mode','1') !== '0';
  if($('cfgAlertThresholdHours')) $('cfgAlertThresholdHours').value = safeGetLocalStorage('mro_alert_threshold_hours','3');
  if($('cfgAutoRefreshInterval')){
    const savedInterval=safeGetLocalStorage('mro_auto_refresh_interval', $('autoRefreshInterval')?.value || '60');
    $('cfgAutoRefreshInterval').value=savedInterval;
  }
  const overlay = $('cfgOverlay');
  if(overlay){
    overlay.style.display = 'flex';
    overlay.classList.add('open');
  }else{
    console.error('[settings] cfgOverlay missing');
    try{alert('系统设置打开失败：未找到设置面板 cfgOverlay');}catch(_){}
  }
}
function closeCfg(){
  const overlay = $('cfgOverlay');
  if(overlay){
    overlay.classList.remove('open');
    overlay.style.display = '';
  }
}

function renderCfgRows(){
  const map=Array.isArray(_cfgBuf)?_cfgBuf:loadUserMap();
  const container=document.getElementById('cfgRows');
  if(!container) return;
  if(!map.length){
    container.innerHTML='<div style="color:var(--text3);font-size:12px;padding:8px 0;">还没有配置，点「+ 添加」添加员工账号</div>';
    return;
  }
  container.innerHTML=map.map((u,i)=>`
    <div class="cfg-row" id="cfgrow-${i}">
      <input class="cfg-input cfg-name" data-idx="${i}" value="${u.name}" placeholder="姓名">
      <input class="cfg-input cfg-email" data-idx="${i}" value="${u.email}" placeholder="user@company.com">
      <button class="cfg-del" data-idx="${i}">✕</button>
    </div>`).join('');
  // MV3 CSP: 用 addEventListener 替代 inline handlers
  container.querySelectorAll('.cfg-name').forEach(el=>{
    el.addEventListener('input', function(){ cfgUpdate(+this.dataset.idx,'name',this.value); });
  });
  container.querySelectorAll('.cfg-email').forEach(el=>{
    el.addEventListener('input', function(){ cfgUpdate(+this.dataset.idx,'email',this.value); });
  });
  container.querySelectorAll('.cfg-del').forEach(el=>{
    el.addEventListener('click', function(){ cfgDel(+this.dataset.idx); });
  });
}

let _cfgBuf=[];
function cfgUpdate(i,field,val){
  if(!Array.isArray(_cfgBuf)) _cfgBuf=loadUserMap();
  if(!_cfgBuf[i]) return;
  _cfgBuf[i][field]=val;
}
function cfgDel(i){
  if(!Array.isArray(_cfgBuf)) _cfgBuf=loadUserMap();
  _cfgBuf.splice(i,1);
  saveUserMap(_cfgBuf);
  renderCfgRows();
  toast('已删除','info',2000);
}
function cfgAddRow(){
  const nameEl=document.getElementById('cfgNewName');
  const emailEl=document.getElementById('cfgNewEmail');
  const name=(nameEl?.value||'').trim();
  const email=(emailEl?.value||'').trim();
  if(!name||!email){toast('姓名和邮箱都不能为空','err');return;}
  if(!Array.isArray(_cfgBuf)) _cfgBuf=loadUserMap();
  _cfgBuf.push({name,email});
  saveUserMap(_cfgBuf);
  if(nameEl) nameEl.value='';
  if(emailEl) emailEl.value='';
  renderCfgRows();toast(`已添加 ${name}`,'ok',2000);
}
function cfgSave(){
  if(!Array.isArray(_cfgBuf)) _cfgBuf=loadUserMap();
  saveUserMap(_cfgBuf);
  if($('cfgWebhookInput')) safeSetLocalStorage('mro_teams_webhook', $('cfgWebhookInput').value);
  if($('cfgWechatInput')) safeSetLocalStorage('mro_wechat_webhook', $('cfgWechatInput').value);
  if($('cfgFormsInput')) safeSetLocalStorage('mro_forms_link', $('cfgFormsInput').value);
  if($('cfgDemoMode')) safeSetLocalStorage('mro_push_demo_mode', $('cfgDemoMode').checked ? '1' : '0');
  if($('cfgAlertThresholdHours')){
    const threshold=String(Math.max(1, Number($('cfgAlertThresholdHours').value) || 3));
    safeSetLocalStorage('mro_alert_threshold_hours', threshold);
  }
  if($('cfgAutoRefreshInterval')){
    const val=$('cfgAutoRefreshInterval').value || '0';
    safeSetLocalStorage('mro_auto_refresh_interval', val);
    if($('autoRefreshInterval')){
      $('autoRefreshInterval').value=val;
      setAutoRefresh();
    }
  }
  toast('✅ 保存成功','ok');closeCfg();
}

/* ─ 生成 EIP 跳转链接 ─ */
function eipUrl(docNo){
  if(!docNo||docNo==='—') return null;
  return '#'; // 演示版不提供真实 EIP 链接
}

function escapeHtml(str){
  return String(str ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
}

function buildPushPreviewHtml(rows, platform='Teams / 企业微信'){
  const items=Array.isArray(rows)&&rows.length?rows:_overtimeItems;
  const grouped={};
  items.forEach(r=>{
    const owner=r['create_user_name']||r.operator||'未指定责任人';
    if(!grouped[owner]) grouped[owner]=[];
    grouped[owner].push(r);
  });
  const ownerNames=Object.keys(grouped);
  const isDemo=safeGetLocalStorage('mro_push_demo_mode','1') !== '0';
  const threshold=safeGetLocalStorage('mro_alert_threshold_hours','3');
  const now=new Date().toLocaleString('zh-CN',{hour12:false});
  const detailHtml=ownerNames.map(name=>{
    const ownerItems=grouped[name];
    const rowsHtml=ownerItems.map(r=>`
      <div style="display:grid;grid-template-columns:90px 1fr 90px 120px 90px;gap:10px;align-items:center;padding:10px 12px;border-top:1px solid rgba(143,178,227,.12);">
        <div style="font-family:'JetBrains Mono',monospace;color:#8ccfff;">${escapeHtml(r['单号']||'—')}</div>
        <div style="min-width:0;">
          <div style="color:#eaf4ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(r['job_name']||'—')}</div>
          <div style="font-size:11px;color:#8eaace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(r['part']||'—')}</div>
        </div>
        <div style="color:#d8edff;">${escapeHtml(r['location_name']||'—')}</div>
        <div style="color:#ffcf66;">${escapeHtml(r._alertStatus||`领料超${threshold}小时未退料`)}</div>
        <div style="color:#ff8a65;text-align:right;font-family:'JetBrains Mono',monospace;">${escapeHtml(r._overtimeHours||'超时')}</div>
      </div>`).join('');
    return `
      <section style="border:1px solid rgba(90,163,255,.22);border-radius:14px;background:rgba(13,22,39,.72);overflow:hidden;margin-top:14px;box-shadow:0 10px 24px rgba(0,0,0,.18);">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;background:linear-gradient(90deg,rgba(90,163,255,.16),rgba(0,212,170,.08));">
          <div style="font-weight:700;color:#f3f8ff;">责任人：${escapeHtml(name)}</div>
          <div style="font-size:12px;color:#67e8f9;border:1px solid rgba(103,232,249,.28);border-radius:999px;padding:3px 9px;background:rgba(103,232,249,.08);">${ownerItems.length} 条异常</div>
        </div>
        <div style="display:grid;grid-template-columns:90px 1fr 90px 120px 90px;gap:10px;padding:8px 12px;font-size:11px;color:#8eaace;background:rgba(255,255,255,.025);">
          <div>单号</div><div>工单 / 料号</div><div>站别</div><div>异常类型</div><div style="text-align:right;">超时</div>
        </div>
        ${rowsHtml}
      </section>`;
  }).join('');

  return `
    <div style="font-family:'Noto Sans SC','Microsoft YaHei',sans-serif;color:#d8edff;">
      <div style="display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:16px;">
        <div>
          <div style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:.02em;">维修异常预警推送预览</div>
          <div style="margin-top:5px;font-size:12px;color:#8eaace;">生成时间：${escapeHtml(now)} · 目标通道：${escapeHtml(platform)}</div>
        </div>
        <div style="font-size:11px;color:${isDemo?'#00d4aa':'#ffcf66'};border:1px solid ${isDemo?'rgba(0,212,170,.35)':'rgba(255,207,102,.35)'};border-radius:999px;padding:5px 10px;background:${isDemo?'rgba(0,212,170,.10)':'rgba(255,207,102,.10)'};">${isDemo?'Demo 模式 · 仅预览':'真实推送模式'}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:12px;">
        <div style="border:1px solid rgba(90,163,255,.22);border-radius:12px;background:rgba(90,163,255,.08);padding:12px;"><div style="font-size:11px;color:#8eaace;">责任人数</div><div style="font-size:24px;font-weight:800;color:#8ccfff;">${ownerNames.length}</div></div>
        <div style="border:1px solid rgba(255,107,53,.26);border-radius:12px;background:rgba(255,107,53,.09);padding:12px;"><div style="font-size:11px;color:#8eaace;">异常总数</div><div style="font-size:24px;font-weight:800;color:#ff8a65;">${items.length}</div></div>
        <div style="border:1px solid rgba(0,212,170,.24);border-radius:12px;background:rgba(0,212,170,.08);padding:12px;"><div style="font-size:11px;color:#8eaace;">报警阈值</div><div style="font-size:24px;font-weight:800;color:#00d4aa;">${escapeHtml(threshold)}h</div></div>
      </div>
      ${detailHtml || '<div style="padding:24px;text-align:center;color:#8eaace;border:1px dashed rgba(143,178,227,.24);border-radius:12px;">当前没有可预览的异常项</div>'}
    </div>`;
}

/* ─ 推送 Teams（频道 Webhook，@提及 + EIP 跳转链接） ─ */
async function sendTeamsAlert(){
  if(!_overtimeItems.length){toast('当前没有超时预警项','info');return;}
  const now=new Date().toLocaleString('zh-CN');
  const threshold=safeGetLocalStorage('mro_alert_threshold_hours','3');

  // 按人分组
  const groupByUser={};
  _overtimeItems.forEach(r=>{
    const k=r['create_user_name']||'未知';
    if(!groupByUser[k])groupByUser[k]=[];
    groupByUser[k].push(r);
  });

  // 收集有超时的员工
  const involvedNames=Object.keys(groupByUser);
  const mentionedUsers=involvedNames.map(name=>{
    const email=getUserEmail(name);
    return email?{name,email}:null;
  }).filter(Boolean);
  const unmapped=involvedNames.filter(n=>!getUserEmail(n));

  // entities（@提及）
  const entities=mentionedUsers.map(u=>({
    type:'mention',
    text:`<at>${u.name}</at>`,
    mentioned:{id:u.email,name:u.name}
  }));

  // 构建消息正文（Markdown，Teams 频道 Webhook 支持）
  let body=`## ⚠️ 领料超${threshold}小时未退料预警\n`;
  body+=`**共 ${_overtimeItems.length} 条** 超时未退料 &nbsp;·&nbsp; ${now}\n\n`;

  // @提及行
  if(mentionedUsers.length){
    body+=`📢 请处理：`+mentionedUsers.map(u=>`<at>${u.name}</at>`).join('  ')+`\n\n`;
  }
  if(unmapped.length){
    body+=`> ⚠️ 未配置账号（无法@）：${unmapped.join('、')}\n\n`;
  }

  body+=`---\n\n`;

  // 按人输出明细
  Object.entries(groupByUser).forEach(([uname,items])=>{
    const email=getUserEmail(uname);
    const atMark=email?`<at>${uname}</at>`:`**${uname}**`;
    body+=`### 👤 ${atMark}（${items.length} 条超时）\n\n`;
    items.slice(0,10).forEach(r=>{
      const link=eipUrl(r['单号']);
      const docLink=link?`[${r['单号']||'—'}](${link})`:(r['单号']||'—');
      body+=`- ⏱ **${r._overtimeHours}** | 单号：${docLink} | 工单：\`${r['job_name']||'—'}\` | 料号：\`${r['part']||'—'}\` | 站别：${r['location_name']||'—'}\n`;
    });
    if(items.length>10) body+=`- *...另有 ${items.length-10} 条，请查看看板*\n`;
    body+=`\n`;
  });

  const formsLink = safeGetLocalStorage('mro_forms_link','');
  if(formsLink){
    body+=`---\n\n`;
    body+=`🔗 [点击进行闭环反馈](${formsLink})\n`;
  }
  const card={text:body, entities};

  const isDemo = safeGetLocalStorage('mro_push_demo_mode','1') !== '0';
  if(isDemo){
    showPushPreview(body, 'Teams');
    return true;
  }

  try{
    const webhookUrl=safeGetLocalStorage('mro_teams_webhook','');
    if(!webhookUrl){
      if(window._isManualPush) toast('请先在⚙️ 系统设置中配置 Teams Webhook URL','err',5000);
      return false;
    }

    toast('正在推送 Teams...','info',3000);
    const j = await sendMsg({action:'sendTeams', url:webhookUrl, card});
    if(j.ok){
      const tip=mentionedUsers.length?` 已@${mentionedUsers.map(u=>u.name).join('、')}`:'（未配置账号，无@提及）';
      toast(`✅ 已推送到 Teams${tip}`,'ok');
      return true;
    }else{
      toast('Teams 推送失败：'+(j.error||'code='+j.status),'err',6000);
      return false;
    }
  }catch(e){
    toast('Teams 推送失败：'+e.message,'err',6000);
    return false;
  }
}

/* ─ 推送 企业微信（Robot Webhook） ─ */
async function sendWeChatAlert(){
  if(!_overtimeItems.length) return false;
  const isDemo = safeGetLocalStorage('mro_push_demo_mode','1') !== '0';
  if(isDemo){
    showPushPreview('', '企业微信');
    return true;
  }
  const webhookUrl=safeGetLocalStorage('mro_wechat_webhook','');
  if(!webhookUrl){
    if(window._isManualPush) toast('请先在⚙️ 系统设置中配置企业微信 Webhook URL','err',5000);
    return false;
  }

  const threshold=safeGetLocalStorage('mro_alert_threshold_hours','3');
  let text = `⚠️ 领料超${threshold}小时未退料预警\n`;
  text += `共 ${_overtimeItems.length} 条超时项\n\n`;

  _overtimeItems.slice(0, 15).forEach(r => {
    text += `> ${r['create_user_name']||'—'}：${r['单号']||'—'} (${r._overtimeHours})\n`;
  });

  const formsLink = safeGetLocalStorage('mro_forms_link','');
  if(formsLink) text += `\n🔗 反馈链接：${formsLink}`;

  try {
    toast('正在推送企业微信...','info',3000);
    const j = await sendMsg({
      action: 'sendWechat',
      url: webhookUrl,
      content: text
    });
    if(j.ok){
      toast(`✅ 已推送到企业微信`,'ok');
      return true;
    } else {
      toast('企业微信推送失败','err');
      return false;
    }
  } catch(e) {
    return false;
  }
}

async function runAllPushes(isManual = false) {
  window._isManualPush = isManual;
  if(!_overtimeItems.length){
    toast('当前没有超时预警项','info');
    window._isManualPush = false;
    return false;
  }
  const isDemo = safeGetLocalStorage('mro_push_demo_mode','1') !== '0';
  if(isDemo){
    showPushPreview('', 'Teams / 企业微信');
    window._isManualPush = false;
    return true;
  }
  const hasTeams=!!safeGetLocalStorage('mro_teams_webhook','').trim();
  const hasWechat=!!safeGetLocalStorage('mro_wechat_webhook','').trim();
  if(!hasTeams && !hasWechat){
    toast('请先在⚙️ 系统设置中配置 Teams 或企业微信 Webhook URL','err',5000);
    window._isManualPush = false;
    return false;
  }
  const t = hasTeams ? await sendTeamsAlert() : false;
  const w = hasWechat ? await sendWeChatAlert() : false;
  window._isManualPush = false;
  return !!(t||w);
}

function showPushPreview(content, platform){
  const overlay = $('previewOverlay');
  const body = $('previewContent');
  if(!overlay || !body) return;
  body.innerHTML = buildPushPreviewHtml(_overtimeItems, platform);
  overlay.classList.add('open');
  toast('Demo Mode：已生成推送内容，未真实发送', 'info');
}
function closePushPreview(){
  const overlay = $('previewOverlay');
  if(overlay) overlay.classList.remove('open');
}

/* ── Table ── */
function getTableData(){
  const q=document.getElementById('tableSearch').value.trim().toLowerCase();
  if(!q) return filteredData;
  return filteredData.filter(r=>{
    const raw=r._raw||{};
    const rawStr=Object.values(raw).map(v=>String(v||'').toLowerCase()).join(' ');
    return r['单号'].toLowerCase().includes(q)||
      r['part'].toLowerCase().includes(q)||
      r['part_name'].toLowerCase().includes(q)||
      r['job_name'].toLowerCase().includes(q)||
      (r['create_user_name']||'').toLowerCase().includes(q)||
      (r['operator']||'').toLowerCase().includes(q)||
      rawStr.includes(q);
  });
}
function sortBy(f){sortField===f?(sortDir=sortDir==='asc'?'desc':'asc'):(sortField=f,sortDir='asc');renderTable();}
const tTag=t=>t==='领料'?'<span class="tag tag-green">领料</span>':t==='退料'?'<span class="tag tag-red">退料</span>':`<span class="tag tag-blue">${t||'—'}</span>`;
const sTag=s=>{const m={EWH:'tag-blue',SMT1:'tag-orange',SMT2:'tag-yellow',DIP:'tag-blue',ASM:'tag-green'};return `<span class="tag ${m[s]||'tag-blue'}">${s||'—'}</span>`;};

function renderTable(){
  applyLocalFilter();
  const data=getTableData();
  const sorted=[...data].sort((a,b)=>{
    const va=a[sortField]||'',vb=b[sortField]||'';
    return sortDir==='asc'?String(va).localeCompare(String(vb)):String(vb).localeCompare(String(va));
  });
  const sz=parseInt(document.getElementById('pageSize').value);
  const tot=sorted.length,tp=Math.max(1,Math.ceil(tot/sz));
  currentPage=Math.min(currentPage,tp);
  const st=(currentPage-1)*sz,pg=sorted.slice(st,st+sz);
  document.getElementById('tableCount').textContent=`${tot} 条`;
  document.getElementById('tableBody').innerHTML=pg.map((r,i)=>`
    <tr data-absidx="${st+i}">
      <td style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text3)">${st+i+1}</td>
      <td><span style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#3d8bff">${r['单号']||'—'}</span></td>
      <td>${tTag(r['receive_return_type'])}</td>
      <td><span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text2)">${r['job_name']||'—'}</span></td>
      <td>${sTag(r['location_name'])}</td>
      <td><span class="part-no">${r['part']||'—'}</span></td>
      <td><div class="spec-cell" title="${r['part_name']}">${r['part_name']||'—'}</div></td>
      <td style="color:var(--text2)">${r['create_user_name']||'—'}</td>
      <td style="color:var(--text3);font-family:'JetBrains Mono',monospace;font-size:11px">${r['create_date']||'—'}</td>
      <td style="color:var(--text2)">${r['operator']||'—'}</td>
    </tr>`).join('');
  // MV3 CSP: 用事件委托替代 inline onclick
  document.getElementById('tableBody').querySelectorAll('tr[data-absidx]').forEach(tr=>{
    tr.style.cursor='pointer';
    tr.addEventListener('click', ()=>showDetail(+tr.dataset.absidx));
  });
  document.getElementById('pageInfo').textContent=`第 ${st+1}–${Math.min(st+sz,tot)} 条，共 ${tot} 条`;
  const pb=document.getElementById('pageBtns');pb.innerHTML='';
  const addB=(lbl,pg,dis,act)=>{const b=document.createElement('button');b.className='page-btn'+(act?' active':'');b.textContent=lbl;b.disabled=dis;b.onclick=()=>{currentPage=pg;renderTable();};pb.appendChild(b);};
  addB('«',1,currentPage===1,false);addB('‹',currentPage-1,currentPage===1,false);
  let s=Math.max(1,currentPage-2),e=Math.min(tp,s+4);if(e-s<4)s=Math.max(1,e-4);
  for(let p=s;p<=e;p++)addB(p,p,false,p===currentPage);
  addB('›',currentPage+1,currentPage===tp,false);addB('»',tp,currentPage===tp,false);
}

/* ─ Detail Modal ─ */
function showDetail(absIdx){
  const data=getTableData();
  const sorted=[...data].sort((a,b)=>{const va=a[sortField]||'',vb=b[sortField]||'';return sortDir==='asc'?String(va).localeCompare(String(vb)):String(vb).localeCompare(String(va));});
  const r=sorted[absIdx];if(!r)return;
  document.getElementById('modal-order-no').textContent=`单号 #${r['单号']||'—'}`;
  const fixed=[['单号',r['单号']],['领退类型',r['receive_return_type']],['工单号',r['job_name']],['站别/工序',r['location_name']],['创建人',r['create_user_name']],['日期',r['create_date']],['料号',r['part'],true],['品名规格',r['part_name'],true]];
  const raw=r._raw||{};
  const rawFields=Object.entries(raw).filter(([k])=>!['_raw'].includes(k)).map(([k,v])=>[k,v===null||v===undefined?'—':String(v)]);
  document.getElementById('modalBody').innerHTML=[
    ...fixed.map(([l,v,f])=>`<div class="detail-item${f?' full':''}"><div class="detail-label">${l}</div><div class="detail-value">${v??'—'}</div></div>`),
    rawFields.length?`<div class="detail-item full" style="background:var(--surface3)"><div class="detail-label" style="margin-bottom:8px">📦 API 原始字段（共 ${rawFields.length} 个）</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">${rawFields.map(([k,v])=>`<div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;"><div style="font-size:10px;color:var(--text3);margin-bottom:3px">${k}</div><div style="font-size:12px;color:var(--text);word-break:break-all">${v}</div></div>`).join('')}</div></div>`:''
  ].join('');
  document.getElementById('modalOverlay').classList.add('open');
}
function closeModal(){document.getElementById('modalOverlay').classList.remove('open');}

/* ═══════════════════════════════════════
   EXPORT
═══════════════════════════════════════ */
function getExportData(){
  let data=[];
  try{ data=getTableData(); }catch(err){ console.warn('[export] getTableData failed, fallback to demo', err); }
  if(data.length) return data;
  if(Array.isArray(filteredData) && filteredData.length) return filteredData;
  if(Array.isArray(allData) && allData.length) return allData;
  if(typeof DEMO!=='undefined' && Array.isArray(DEMO) && DEMO.length){
    allData=[...DEMO];
    filteredData=[...DEMO];
    try{ updateAll(); }catch(err){ console.warn('[export] demo update skipped', err); }
    return [...DEMO];
  }
  return [];
}

function writeWorkbookDownload(wb, filename){
  if(typeof XLSX==='undefined') return false;
  try{
    const payload=XLSX.write(wb,{bookType:'xlsx',type:'array'});
    return downloadBlob(filename,payload,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }catch(err){
    console.error('[export] XLSX write failed', err);
    return false;
  }
}

function exportExcel(){
  console.log('[export] start', 'excel');
  const data=getExportData();
  console.log('[export] rows:', data.length);
  if(!data.length){toast('当前无可导出的数据，请先加载或查询数据。','err');alert('当前无可导出的数据，请先加载或查询数据。');return;}
  const raw0=data[0]._raw||{};const rawKeys=Object.keys(raw0);
  const hdr=['单号','领退类型','工单号','站别/工序','料号','品名规格','创建人','日期','操作人',...rawKeys];
  const rows=data.map(r=>[r['单号'],r['receive_return_type'],r['job_name'],r['location_name'],r['part'],r['part_name'],r['create_user_name'],r['create_date'],r['operator'],...rawKeys.map(k=>r._raw[k]??'')]);
  const stamp=formatExportStamp();

  if(typeof XLSX!=='undefined'){
    const wb=XLSX.utils.book_new();
    const ws=XLSX.utils.aoa_to_sheet([hdr,...rows]);
    ws['!cols']=[10,8,22,12,22,40,10,12,10,...rawKeys.map(()=>({wch:15}))].map(w=>typeof w==='number'?{wch:w}:w);
    XLSX.utils.book_append_sheet(wb,ws,'维修领退料明细');
    const sta=[...new Set(data.map(r=>r['location_name']))].filter(Boolean).sort();
    const sum=[['站别','领料','退料','合计'],...sta.map(s=>[s,data.filter(r=>r['location_name']===s&&r['receive_return_type']==='领料').length,data.filter(r=>r['location_name']===s&&r['receive_return_type']==='退料').length,data.filter(r=>r['location_name']===s).length]),['合计',data.filter(r=>r['receive_return_type']==='领料').length,data.filter(r=>r['receive_return_type']==='退料').length,data.length]];
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(sum),'按站别汇总');
    appendTop10Sheet(wb,data);
    const fname=`领退料看板_筛选数据_${stamp}.xlsx`;
    if(writeWorkbookDownload(wb,fname)){
      toast(`已导出 ${data.length} 条 → ${fname}`,'ok');
      return;
    }
  } else {
    const fname=`领退料看板_筛选数据_${stamp}.csv`;
    if(downloadCsv(fname,[hdr,...rows])){
      toast(`Excel 导出依赖未加载，已导出 ${data.length} 条 CSV：${fname}`,'ok');
    }
  }
  if(typeof XLSX!=='undefined'){
    const fname=`领退料看板_筛选数据_${stamp}.csv`;
    if(downloadCsv(fname,[hdr,...rows])){
      toast(`XLSX 写入失败，已导出 ${data.length} 条 CSV：${fname}`,'ok');
    }
  }
}

function exportTop10Excel(){
  console.log('[export] start', 'top10');
  const data=getExportData();
  console.log('[export] rows:', data.length);
  if(!data.length){toast('当前无可导出的数据，请先加载或查询数据。','err');alert('当前无可导出的数据，请先加载或查询数据。');return;}
  const stamp=formatExportStamp();
  const rows=buildTop10Rows(data);
  if(typeof XLSX==='undefined'){
    const fname=`领退料TOP10_${stamp}.csv`;
    if(downloadCsv(fname,rows)){
      toast(`Excel 导出依赖未加载，已导出 CSV：${fname}`,'ok');
    }
    return;
  }
  const wb=XLSX.utils.book_new();
  appendTop10Sheet(wb,data);
  const fname=`领退料TOP10_${stamp}.xlsx`;
  if(writeWorkbookDownload(wb,fname)){
    toast(`Top10 已导出：${fname}`,'ok');
    return;
  }
  const fallback=`领退料TOP10_${stamp}.csv`;
  if(downloadCsv(fallback,rows)){
    toast(`XLSX 写入失败，已导出 CSV：${fallback}`,'ok');
  }
}

function buildTop10Rows(data){
  const issues=data.filter(r=>r['receive_return_type']==='领料');
  const returns=data.filter(r=>r['receive_return_type']==='退料');
  const top10i=topN(issues,r=>r['part']);
  const top10r=topN(returns,r=>r['part']);
  const top10p=topN(data,r=>r['part']);
  const top10w=topN(data,r=>r['job_name']);
  const maxLen=Math.max(top10i.length,top10r.length,top10p.length,top10w.length);
  const rows=[['领料Top10料号','领料次数','','退料Top10料号','退料次数','','活跃料号Top10','合计次数','','工单Top10','单据数']];
  for(let i=0;i<maxLen;i++){
    rows.push([
      top10i[i]?top10i[i][0]:'',top10i[i]?top10i[i][1]:'',
      '',
      top10r[i]?top10r[i][0]:'',top10r[i]?top10r[i][1]:'',
      '',
      top10p[i]?top10p[i][0]:'',top10p[i]?top10p[i][1]:'',
      '',
      top10w[i]?top10w[i][0]:'',top10w[i]?top10w[i][1]:'',
    ]);
  }
  return rows;
}

function appendTop10Sheet(wb,data){
  const rows=buildTop10Rows(data);
  const ws=XLSX.utils.aoa_to_sheet(rows);
  ws['!cols']=[22,8,4,22,8,4,22,8,4,22,8].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb,ws,'Top10分析');
}

function exportAlertExcel(){
  if(!_overtimeItems.length){toast('当前无可导出的数据，请先加载或查询数据。','err');return;}
  const hdr=['单号','工单号','料号','品名规格','站别','创建人','创建日期','超时时长'];
  const rows=_overtimeItems.map(r=>[r['单号'],r['job_name'],r['part'],r['part_name'],r['location_name'],r['create_user_name'],r['create_date'],r._overtimeHours]);
  const stamp=formatExportStamp();
  if(typeof XLSX==='undefined'){
    const fname=`领退料超时预警_${stamp}.csv`;
    downloadCsv(fname,[hdr,...rows]);
    toast(`Excel 导出依赖未加载，已导出 CSV：${fname}`,'ok');
    return;
  }
  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.aoa_to_sheet([hdr,...rows]);
  ws['!cols']=[10,22,22,36,8,8,12,10].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb,ws,'超时预警');
  const fname=`领退料超时预警_${stamp}.xlsx`;
  XLSX.writeFile(wb,fname);
  toast(`已导出 ${_overtimeItems.length} 条预警：${fname}`,'ok');
}

/* ═══════════════════════════════════════
   Teams 推送设置 & 自动推送
═══════════════════════════════════════ */
const PUSH_CFG_KEY='mro_push_cfg';
let _pushTimer=null;
let _lastPushTime=0;

function loadPushCfg(){
  return safeGetJsonLocalStorage(PUSH_CFG_KEY, {});
}
function savePushCfg(){
  const cfg={
    enabled:document.getElementById('autoPushEnabled').checked,
    interval:parseInt(document.getElementById('pushInterval').value),
    workHoursOnly:document.getElementById('workHoursOnly').checked,
  };
  safeSetLocalStorage(PUSH_CFG_KEY, JSON.stringify(cfg));
  document.getElementById('autoPushLabel').textContent=cfg.enabled?'已开启':'已关闭';
  restartPushTimer(cfg);
  updateNextPushInfo(cfg);
}

function openPushCfg(){
  const cfg=loadPushCfg();
  document.getElementById('autoPushEnabled').checked=cfg.enabled||false;
  document.getElementById('pushInterval').value=cfg.interval||60;
  document.getElementById('workHoursOnly').checked=cfg.workHoursOnly!==false;
  document.getElementById('autoPushLabel').textContent=(cfg.enabled)?'已开启':'已关闭';
  updateNextPushInfo(cfg);
  document.getElementById('pushCfgOverlay').classList.add('open');
}
function closePushCfg(){document.getElementById('pushCfgOverlay').classList.remove('open');}

function updateNextPushInfo(cfg){
  const el=document.getElementById('nextPushInfo');
  if(!cfg.enabled){el.textContent='自动推送已关闭';return;}
  const next=new Date(_lastPushTime+(cfg.interval||60)*60000);
  el.textContent=`下次推送：${next.toLocaleTimeString('zh-CN',{hour12:false})}（间隔 ${cfg.interval||60} 分钟）`;
}

function restartPushTimer(cfg){
  if(_pushTimer){clearInterval(_pushTimer);_pushTimer=null;}
  if(!cfg.enabled) return;
  const ms=(cfg.interval||60)*60000;
  _pushTimer=setInterval(async()=>{
    const now=new Date();
    if(cfg.workHoursOnly){
      const h=now.getHours();
      if(h<8||h>=18) return;
    }
    // 刷新数据再检查
    await fetchData(true);
    if(_overtimeItems.length>0){
      await sendTeamsAlert();
      _lastPushTime=Date.now();
    }
  },ms);
  _lastPushTime=Date.now();
}

// 启动时恢复推送设置
(function initPushTimer(){
  const cfg=loadPushCfg();
  if(cfg.enabled) restartPushTimer(cfg);
})();

/* ── Clock ── */
setInterval(()=>{document.getElementById('currentTime').textContent=new Date().toLocaleTimeString('zh-CN',{hour12:false});},1000);

/* ═══════════════════════════════════════
   DEMO DATA
═══════════════════════════════════════ */
const DEMO=[
  {'单号':'167226','receive_return_type':'领料','job_name':'DEMO-WO-001','location_name':'EWH','part':'DEMO-PN-001','part_name':'IC;RENESAS;uPD720142','create_user_name':'张三','create_date':'2026-03-21','operator':'张三',_raw:{}},
  {'单号':'167225','receive_return_type':'退料','job_name':'DEMO-WO-002','location_name':'SMT1','part':'DEMO-PN-002','part_name':'CPU;Rockchip;ARM;2GHz','create_user_name':'李四','create_date':'2026-03-21','operator':'李娜',_raw:{}},
  {'单号':'167221','receive_return_type':'领料','job_name':'DEMO-WO-003','location_name':'SMT2','part':'DEMO-PN-003','part_name':'Connectors;Wire toBoard','create_user_name':'王五','create_date':'2026-03-20','operator':'王芳',_raw:{}},
  {'单号':'167220','receive_return_type':'领料','job_name':'DEMO-WO-004','location_name':'SMT1','part':'DEMO-PN-004','part_name':'Connectors;Wire toBoard','create_user_name':'张三','create_date':'2026-03-20','operator':'张伟',_raw:{}},
  {'单号':'167218','receive_return_type':'领料','job_name':'DEMO-WO-005','location_name':'SMT1','part':'DEMO-PN-005','part_name':'MEMORY-eMMC;PHISON','create_user_name':'赵六','create_date':'2026-03-20','operator':'陈磊',_raw:{}},
  {'单号':'167214','receive_return_type':'领料','job_name':'DEMO-WO-006','location_name':'ASM','part':'DEMO-PN-006','part_name':'FLEX;Huntkey','create_user_name':'张三','create_date':'2026-03-19','operator':'刘洋',_raw:{}}
];

/* ════════════════════════════════════════
   扩展模式：自动刷新（无需登录逻辑）
════════════════════════════════════════ */
let _autoRefreshTimer = null;
let _nextRefreshAt    = 0;

function setAutoRefresh(){
  if(_autoRefreshTimer){ clearInterval(_autoRefreshTimer); _autoRefreshTimer = null; }
  const intervalEl=document.getElementById('autoRefreshInterval');
  const m = parseInt(intervalEl?.value || '0', 10);
  safeSetLocalStorage('mro_auto_refresh_interval', String(m || 0));
  const el = document.getElementById('nextRefreshInfo');
  if(!m){ if(el) el.textContent = ''; return; }
  const ms = m * 60000;
  _nextRefreshAt = Date.now() + ms;
  _autoRefreshTimer = setInterval(async()=>{
    toast('⟳ 自动刷新数据...','info',2000);
    await fetchData(true);
  }, ms);
  const h = new Date(_nextRefreshAt);
  if(el) el.textContent = `下次：${h.getHours().toString().padStart(2,'0')}:${h.getMinutes().toString().padStart(2,'0')}`;
}
setInterval(()=>{
  if(!_autoRefreshTimer || !_nextRefreshAt) return;
  const left = Math.max(0, Math.ceil((_nextRefreshAt - Date.now()) / 1000));
  const mm = Math.floor(left/60), ss = left%60;
  const el=document.getElementById('nextRefreshInfo');
  if(el) el.textContent = `下次：${mm}:${ss.toString().padStart(2,'0')}`;
}, 1000);

function initDateDefaults(){
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth()+1).padStart(2,'0');
  const d = String(now.getDate()).padStart(2,'0');
  document.getElementById('dateFrom').value = `${y}-${m}-01`;
  document.getElementById('dateTo').value   = `${y}-${m}-${d}`;
}

function resetFilters(){
  initDateDefaults();
  document.getElementById('filterLineType').value='维修';
  document.getElementById('filterLineName').value='维修';
  document.getElementById('filterJobName').value='';
  document.getElementById('filterPart').value='';
  document.getElementById('filterType').value='';
  document.getElementById('filterStation').value='';
  if(document.getElementById('filterOperator')) document.getElementById('filterOperator').value='';
  fetchData(true);
}

/* ═══════════════════════════════════════
   EVENT LISTENER BINDINGS (MV3 CSP 合规)
   MV3 不允许 inline onclick/onchange，全部改用 addEventListener
═══════════════════════════════════════ */
window.openSettingsPanel = openCfg;
window.closeSettingsPanel = closeCfg;
window.saveSettings = cfgSave;
window.openCfg = openCfg;
window.closeCfg = closeCfg;
window.cfgSave = cfgSave;
window.exportExcel = exportExcel;
window.exportTop10 = exportTop10Excel;
window.exportTop10Excel = exportTop10Excel;

function bindEvents(){
  // ── Header & Status bar ──
  document.getElementById('btnOpenCfg')?.addEventListener('click', openSystemSettings);
  $('autoRefreshInterval')?.addEventListener('change', setAutoRefresh);
  $('btnRefreshAll')?.addEventListener('click', ()=>fetchData(true));
  $('btnManualRefresh')?.addEventListener('click', async()=>{
    const btn  = $('btnManualRefresh');
    const icon = $('btnManualRefreshIcon');
    if(btn){ btn.disabled = true; btn.style.opacity = '.6'; btn.style.cursor = 'not-allowed'; }
    if(icon){ icon.style.transform = 'rotate(360deg)'; icon.style.transition = 'transform .6s linear'; }
    toast('⟳ 正在扫描数据引擎...','info',3000);
    await fetchData(true);
    // 手动刷新后重置自动刷新倒计时（让1小时从现在重新计算）
    setAutoRefresh();
    if(icon){ icon.style.transform = ''; icon.style.transition = 'none'; }
    if(btn){ btn.disabled = false; btn.style.opacity = ''; btn.style.cursor = ''; }
  });
  $('btnEipLogin')?.addEventListener('click', openEipLogin);

  // ── Alert panel ──
  $('btnPushCfg')?.addEventListener('click', openPushCfg);
  $('btnSendTeams')?.addEventListener('click', () => runAllPushes(true));
  $('btnExportAlert')?.addEventListener('click', exportAlertExcel);

  // ── Filter bar ──
  $('filterOperator')?.addEventListener('input', ()=>{ applyLocalFilter(); renderTable(); });
  $('btnQuery')?.addEventListener('click', ()=>fetchData(true));
  $('btnReset')?.addEventListener('click', resetFilters);
  $('btnExportExcel')?.addEventListener('click', exportExcel);

  // ── Top10 ──
  $('btnExportTop10')?.addEventListener('click', exportTop10Excel);

  // ── Table search & page size ──
  $('tableSearch')?.addEventListener('input', renderTable);
  $('pageSize')?.addEventListener('change', renderTable);

  // ── Sortable column headers (data-sort) ──
  document.querySelectorAll('th[data-sort]').forEach(th=>{
    th.style.cursor='pointer';
    th.addEventListener('click', ()=>sortBy(th.dataset.sort));
  });

  // ── Detail modal ──
  $('modalOverlay')?.addEventListener('click', e=>{ if(e.target===$('modalOverlay')) closeModal(); });
  $('btnCloseModal')?.addEventListener('click', closeModal);

  // ── Push config modal ──
  $('pushCfgOverlay')?.addEventListener('click', e=>{ if(e.target===$('pushCfgOverlay')) closePushCfg(); });
  $('btnClosePushCfgX')?.addEventListener('click', closePushCfg);
  $('autoPushEnabled')?.addEventListener('change', savePushCfg);
  $('pushInterval')?.addEventListener('change', savePushCfg);
  $('workHoursOnly')?.addEventListener('change', savePushCfg);
  $('btnClosePushCfg')?.addEventListener('click', closePushCfg);
  $('btnPushNow')?.addEventListener('click', ()=>{ runAllPushes(true); closePushCfg(); });

  // ── Employee config modal ──
  $('cfgOverlay')?.addEventListener('click', e=>{ if(e.target===$('cfgOverlay')) closeCfg(); });
  $('btnCloseCfgX')?.addEventListener('click', closeCfg);
  $('cfgWebhookInput')?.addEventListener('input', function(){ safeSetLocalStorage('mro_teams_webhook', this.value); });
  $('cfgWechatInput')?.addEventListener('input', function(){ safeSetLocalStorage('mro_wechat_webhook', this.value); });
  $('cfgFormsInput')?.addEventListener('input', function(){ safeSetLocalStorage('mro_forms_link', this.value); });
  $('cfgDemoMode')?.addEventListener('change', function(){ safeSetLocalStorage('mro_push_demo_mode', this.checked ? '1' : '0'); });
  $('cfgAlertThresholdHours')?.addEventListener('change', function(){ safeSetLocalStorage('mro_alert_threshold_hours', String(Math.max(1, Number(this.value) || 3))); checkOvertimeAndRender(); });
  $('btnCfgAdd')?.addEventListener('click', cfgAddRow);
  $('btnCloseCfg')?.addEventListener('click', closeCfg);
  $('btnCfgSave')?.addEventListener('click', cfgSave);

  // ── Preview modal ──
  $('previewOverlay')?.addEventListener('click', e=>{ if(e.target===$('previewOverlay')) closePushPreview(); });
  $('btnClosePreview')?.addEventListener('click', closePushPreview);
  $('btnClosePreviewX')?.addEventListener('click', closePushPreview);
}

window.addEventListener('DOMContentLoaded', async()=>{
  if(safeGetLocalStorage('mro_push_demo_mode', null) === null) {
    safeSetLocalStorage('mro_push_demo_mode', '1');
  }
  const savedAutoRefresh=safeGetLocalStorage('mro_auto_refresh_interval', null);
  if(savedAutoRefresh !== null && $('autoRefreshInterval')){
    $('autoRefreshInterval').value=savedAutoRefresh;
  }
  bindEvents();
  initDateDefaults();
  // 确认 XLSX 是否已加载；缺失时导出会自动降级为 CSV。
  await _ensureLibs();
  // 直接加载数据（扩展会自动使用浏览器中的 EIP cookie）
  await fetchData(true);
  // 首次数据加载完成后，再启动自动刷新倒计时（默认1小时）
  // 这样"下次刷新"时间从数据拉完那一刻开始计算，更准确
  setAutoRefresh();
});

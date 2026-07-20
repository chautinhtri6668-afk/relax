const $=s=>document.querySelector(s);
const $$=s=>document.querySelectorAll(s);
const KEY="so-diem-vui-v2";
const DB_NAME="so-diem-vui-db";
const DB_STORE="data";
const CLOUD_URL_KEY="so-diem-vui-cloud-url";
const CLOUD_TOKEN_KEY="so-diem-vui-cloud-token";
const DEFAULT_CLOUD_URL="";
const DEFAULT_CLOUD_TOKEN="";
const BACKUP_PREFIX="so-diem-vui-backup-";
const MAX_BACKUPS=8;
const REFERENCE_MODE_KEY="so-diem-vui-reference-mode";
const REFERENCE_MONTH_KEY="so-diem-vui-reference-month";
const LAW_MODE_KEY="so-diem-vui-law-mode";
const LAW_MONTH_KEY="so-diem-vui-law-month";
const XSMB_CSV_URL="https://raw.githubusercontent.com/khiemdoan/vietnam-lottery-xsmb-analysis/refs/heads/main/data/xsmb.csv";
const EMPTY_STATE={members:[],results:[],entries:[]};
const AUTO_HISTORY_LIMIT=720;
let storageOk=true;
let loadHadError=false;
let lastSaveMessage="";
let saveRun=0;
let state=loadState();
let stateCache=buildStateCache(state);
let autoRowsCache=new Map();
let monthBacktestCache=new Map();
let lawMonthBacktestCache=new Map();
let deferredRenderId=0;
let pastedImage="";
let ocrRun=0;
let isAdmin=sessionStorage.getItem("so-diem-vui-admin")==="1";
let currentPlayerId=sessionStorage.getItem("so-diem-vui-player")||"";
const patternBaseState={
  forecast:{manual:false,latest:""},
  law:{manual:false,latest:""},
  dbbridge:{manual:false,latest:""}
};
const ADMIN_HASH="e6121f114d1b02a340a2f495504c92feb62a13590a161c25f282d1845aa600ad";

const uid=()=>crypto.randomUUID?crypto.randomUUID():String(Date.now()+Math.random());
const localDate=d=>{
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,"0");
  const day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
};
function normalizeDateValue(value){
  const s=String(value||"").trim();
  let m=s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if(m)return `${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`;
  m=s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if(m)return `${m[3]}-${String(m[2]).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`;
  return s;
}
const today=()=>localDate(new Date());
const addDays=n=>{const d=new Date();d.setDate(d.getDate()+n);return localDate(d)};
const yesterday=()=>addDays(-1);
$("#resultDate").value=today(); $("#entryDate").value=today();
applyCloudConfigFromUrl();
$("#referenceMode").value=localStorage.getItem(REFERENCE_MODE_KEY)||"fun";
$("#referenceBacktestMonth").value=localStorage.getItem(REFERENCE_MONTH_KEY)||today().slice(0,7);
$("#lawReferenceMode").value=localStorage.getItem(LAW_MODE_KEY)||"fun";
$("#lawBacktestMonth").value=localStorage.getItem(LAW_MONTH_KEY)||today().slice(0,7);

function normalizeState(data){
  const safe=data&&typeof data==="object"?data:{};
  const resultsByDate=new Map();
  (Array.isArray(safe.results)?safe.results:[]).forEach(({image,...r})=>{
    const date=normalizeDateValue(r?.date);
    if(date) resultsByDate.set(date,{...r,date});
  });
  return {
    members:(Array.isArray(safe.members)?safe.members:[]).map(m=>({
      ...m,
      id:m.id||String(Date.now()+Math.random()),
      name:String(m.name||"Người chơi").trim()||"Người chơi",
      passwordHash:m.passwordHash||""
    })),
    results:[...resultsByDate.values()],
    entries:Array.isArray(safe.entries)?safe.entries:[]
  };
}

function stateStats(data){
  const safe=normalizeState(data);
  return {
    members:safe.members.length,
    entries:safe.entries.length,
    results:safe.results.length
  };
}

function stateStatsText(data){
  const s=stateStats(data);
  return `${s.members} người chơi, ${s.entries} lượt dự đoán, ${s.results} ngày kết quả`;
}
function mergeResultsByDate(...resultLists){
  const map=new Map();
  resultLists.flat().filter(Boolean).forEach(result=>{
    if(result?.date)map.set(result.date,result);
  });
  return [...map.values()];
}

function hasPlayerData(data){
  const s=stateStats(data);
  return s.members>0||s.entries>0;
}

function makeLocalBackup(reason="backup"){
  try{
    const key=`${BACKUP_PREFIX}${Date.now()}`;
    localStorage.setItem(key,JSON.stringify({
      reason,
      createdAt:new Date().toISOString(),
      data:normalizeState(state)
    }));
    pruneBackups();
    return key;
  }catch{
    return "";
  }
}

function listBackups(){
  const items=[];
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);
    if(key&&key.startsWith(BACKUP_PREFIX)){
      try{
        const item=JSON.parse(localStorage.getItem(key)||"{}");
        items.push({key,...item});
      }catch{}
    }
  }
  return items.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
}

function pruneBackups(){
  listBackups().slice(MAX_BACKUPS).forEach(item=>localStorage.removeItem(item.key));
}

function restoreLatestBackup(){
  if(!requireAdmin())return;
  const backup=listBackups()[0];
  if(!backup?.data){alert("Chưa có backup nội bộ để khôi phục.");return}
  const created=backup.createdAt?new Date(backup.createdAt).toLocaleString("vi-VN"):"không rõ thời gian";
  if(!confirm(`Khôi phục backup ${created} (${stateStatsText(backup.data)}) và ghi đè dữ liệu máy này?`))return;
  makeLocalBackup("before-restore-backup");
  state=normalizeState(backup.data);
  save();
  alert(`Đã khôi phục backup: ${stateStatsText(state)}.`);
}

function shouldReplaceLocalWith(incoming,sourceLabel){
  const currentHasPlayers=hasPlayerData(state);
  const incomingHasPlayers=hasPlayerData(incoming);
  if(currentHasPlayers&&!incomingHasPlayers){
    alert(`${sourceLabel} không có dữ liệu người chơi/lượt dự đoán (${stateStatsText(incoming)}), nên app không ghi đè dữ liệu máy này.\n\nNếu muốn chỉ lấy kết quả, hãy dùng Cập nhật CSV hoặc nhập file kết quả riêng.`);
    return false;
  }
  return confirm(`${sourceLabel}: ${stateStatsText(incoming)}.\nDữ liệu máy này: ${stateStatsText(state)}.\n\nGhi đè dữ liệu máy này?`);
}

function buildStateCache(data){
  const results=[...(data.results||[])].sort((a,b)=>a.date.localeCompare(b.date));
  const resultsDesc=[...results].reverse();
  const resultsByDate=new Map(results.map(r=>[r.date,r]));
  const resultYears=[...new Set(results.map(r=>String(r.date).slice(0,4)).filter(Boolean))].sort((a,b)=>b.localeCompare(a));
  return {results,resultsDesc,resultsByDate,resultYears};
}

function touchState(){
  state=normalizeState(state);
  stateCache=buildStateCache(state);
  autoRowsCache=new Map();
  monthBacktestCache=new Map();
  lawMonthBacktestCache=new Map();
}

function loadState(){
  try{
    return normalizeState(JSON.parse(localStorage.getItem(KEY)||JSON.stringify(EMPTY_STATE)));
  }catch{
    storageOk=false;
    loadHadError=true;
    lastSaveMessage="Không đọc được dữ liệu cũ. File lưu có thể bị hỏng.";
    return normalizeState(EMPTY_STATE);
  }
}

function openDataDb(){
  return new Promise((resolve,reject)=>{
    if(!window.indexedDB){reject(new Error("IndexedDB không khả dụng"));return}
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>req.result.createObjectStore(DB_STORE);
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function idbReadState(){
  const db=await openDataDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(DB_STORE,"readonly");
    const req=tx.objectStore(DB_STORE).get(KEY);
    req.onsuccess=()=>resolve(req.result?normalizeState(req.result):null);
    req.onerror=()=>reject(req.error);
    tx.oncomplete=()=>db.close();
    tx.onerror=()=>{db.close();reject(tx.error)};
  });
}
async function idbWriteState(data){
  const db=await openDataDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(DB_STORE,"readwrite");
    tx.objectStore(DB_STORE).put(normalizeState(data),KEY);
    tx.oncomplete=()=>{db.close();resolve()};
    tx.onerror=()=>{db.close();reject(tx.error)};
  });
}
async function initPersistentState(){
  try{
    const saved=await idbReadState();
    if(saved){
      state=saved;
      touchState();
      storageOk=true;
      lastSaveMessage="Đã tải dữ liệu đã lưu";
      render();
      return;
    }
  }catch{
    if(!loadHadError)lastSaveMessage="Đang dùng bộ lưu trình duyệt cũ.";
  }
  save();
}

function save(){
  touchState();
  const snapshot=state;
  const stamp=new Date().toLocaleTimeString("vi-VN");
  let localSaved=false;
  try{
    localStorage.setItem(KEY,JSON.stringify(snapshot));
    storageOk=true;
    localSaved=true;
    lastSaveMessage=`Đã lưu ${stamp}`;
  }catch{
    lastSaveMessage="localStorage đầy, đang lưu bằng IndexedDB...";
  }
  const run=++saveRun;
  idbWriteState(snapshot).then(()=>{
    if(run!==saveRun)return;
    storageOk=true;
    lastSaveMessage=`Đã lưu ${stamp}`;
    updateStorageStatus();
  }).catch(()=>{
    if(localSaved)return;
    storageOk=false;
    lastSaveMessage="Chưa lưu được. Hãy bấm Xuất hoặc Xuất KQ để sao lưu.";
    updateStorageStatus();
    alert(lastSaveMessage);
  });
  render();
}

function updateStorageStatus(){
  const el=$("#storageStatus");
  if(!el)return;
  el.textContent=lastSaveMessage||"Dữ liệu lưu trên trình duyệt này";
  el.className=`storage-status ${storageOk?"ok":"warn"}`;
}
function deferRender(fn,targetSelector){
  const id=++deferredRenderId;
  const target=targetSelector?$(targetSelector):null;
  if(target)target.innerHTML='<p class="muted">Đang tính...</p>';
  requestAnimationFrame(()=>setTimeout(()=>{
    if(id===deferredRenderId)fn();
  },0));
}
function cloudConfig(){
  return {
    url:localStorage.getItem(CLOUD_URL_KEY)||DEFAULT_CLOUD_URL,
    token:localStorage.getItem(CLOUD_TOKEN_KEY)||DEFAULT_CLOUD_TOKEN
  };
}
function applyCloudConfigFromUrl(){
  try{
    const params=new URLSearchParams(location.search);
    const url=params.get("cloudUrl")||params.get("cloud_url");
    const token=params.get("cloudToken")||params.get("token");
    if(url)localStorage.setItem(CLOUD_URL_KEY,url.trim());
    if(token)localStorage.setItem(CLOUD_TOKEN_KEY,token.trim());
  }catch{}
}
function ensureCloudConfig(){
  const cfg=cloudConfig();
  if(cfg.url&&cfg.token)return cfg;
  return null;
}
function appConfig(){
  return {
    cloudUrl:localStorage.getItem(CLOUD_URL_KEY)||"",
    cloudToken:localStorage.getItem(CLOUD_TOKEN_KEY)||"",
    referenceMode:localStorage.getItem(REFERENCE_MODE_KEY)||$("#referenceMode")?.value||"fun",
    referenceMonth:localStorage.getItem(REFERENCE_MONTH_KEY)||$("#referenceBacktestMonth")?.value||today().slice(0,7),
    lawMode:localStorage.getItem(LAW_MODE_KEY)||$("#lawReferenceMode")?.value||"fun",
    lawMonth:localStorage.getItem(LAW_MONTH_KEY)||$("#lawBacktestMonth")?.value||today().slice(0,7)
  };
}
function applyAppConfig(config={}){
  if(config.cloudUrl!==undefined)localStorage.setItem(CLOUD_URL_KEY,String(config.cloudUrl||""));
  if(config.cloudToken!==undefined)localStorage.setItem(CLOUD_TOKEN_KEY,String(config.cloudToken||""));
  if(config.referenceMode)localStorage.setItem(REFERENCE_MODE_KEY,config.referenceMode);
  if(config.referenceMonth)localStorage.setItem(REFERENCE_MONTH_KEY,config.referenceMonth);
  if(config.lawMode)localStorage.setItem(LAW_MODE_KEY,config.lawMode);
  if(config.lawMonth)localStorage.setItem(LAW_MONTH_KEY,config.lawMonth);
  if($("#referenceMode"))$("#referenceMode").value=localStorage.getItem(REFERENCE_MODE_KEY)||"fun";
  if($("#referenceBacktestMonth"))$("#referenceBacktestMonth").value=localStorage.getItem(REFERENCE_MONTH_KEY)||today().slice(0,7);
  if($("#lawReferenceMode"))$("#lawReferenceMode").value=localStorage.getItem(LAW_MODE_KEY)||"fun";
  if($("#lawBacktestMonth"))$("#lawBacktestMonth").value=localStorage.getItem(LAW_MONTH_KEY)||today().slice(0,7);
  if(isAdmin)fillCloudForm();
}
function exportDataPackage(){
  touchState();
  return {
    schema:"so-diem-vui-data-v1",
    exportedAt:new Date().toISOString(),
    config:appConfig(),
    data:normalizeState(state)
  };
}
function unpackImportedData(raw){
  const parsed=JSON.parse(raw);
  if(parsed?.schema==="so-diem-vui-data-v1"){
    return {data:normalizeState(parsed.data),config:parsed.config||{},label:"Gói data"};
  }
  if(parsed?.members||parsed?.entries||parsed?.results){
    return {data:normalizeState(parsed),config:null,label:"File dữ liệu cũ"};
  }
  if(parsed?.data&&(parsed.data.members||parsed.data.entries||parsed.data.results)){
    return {data:normalizeState(parsed.data),config:parsed.config||null,label:"File data"};
  }
  throw new Error("File không có dữ liệu app");
}
function setCloudStatus(message,ok=true){
  const el=$("#cloudStatus");
  if(el){
    el.textContent=message;
    el.className=ok?"cloud-status-note ok":"cloud-status-note warn";
  }
  lastSaveMessage=message;
  updateStorageStatus();
}
function fillCloudForm(){
  const cfg=cloudConfig();
  $("#cloudUrl").value=cfg.url;
  $("#cloudToken").value=cfg.token;
}
function saveCloudConfig(){
  if(!requireAdmin())return false;
  const url=$("#cloudUrl").value.trim();
  const token=$("#cloudToken").value.trim();
  if(!url||!token){setCloudStatus("Cần nhập đủ Web App URL và token.",false);return false}
  localStorage.setItem(CLOUD_URL_KEY,url);
  localStorage.setItem(CLOUD_TOKEN_KEY,token);
  setCloudStatus("Đã lưu cấu hình cloud.");
  return true;
}
function jsonp(url,params={}){
  return new Promise((resolve,reject)=>{
    const callback=`__sdvCloud${Date.now()}${Math.random().toString(16).slice(2)}`;
    const script=document.createElement("script");
    const query=new URLSearchParams({...params,callback});
    const timer=setTimeout(()=>{cleanup();reject(new Error("Cloud không phản hồi"))},20000);
    function cleanup(){
      clearTimeout(timer);
      delete window[callback];
      script.remove();
    }
    window[callback]=data=>{cleanup();resolve(data)};
    script.onerror=()=>{cleanup();reject(new Error("Không tải được Apps Script"))};
    script.src=`${url}${url.includes("?")?"&":"?"}${query}`;
    document.body.appendChild(script);
  });
}
async function fetchCloudDataForCheck(allowPrompt=false){
  const cfg=isAdmin?null:ensureCloudConfig();
  if(isAdmin){
    if(!saveCloudConfig())return null;
  }else if(!cfg){
    throw new Error("Chưa có cấu hình cloud. Hãy mở đúng link người chơi do QTV gửi, hoặc nhờ QTV lưu sẵn cloud trong app.");
  }
  const finalCfg=isAdmin?cloudConfig():cfg;
  const res=await jsonp(finalCfg.url,{action:"load",token:finalCfg.token});
  if(!res?.ok)throw new Error(res?.error||"Cloud trả về lỗi");
  if(!res.data)throw new Error("Cloud chưa có dữ liệu");
  return {data:normalizeState(res.data),updatedAt:res.updatedAt||""};
}
async function postCloudState(data){
  const cfg=cloudConfig();
  await fetch(cfg.url,{
    method:"POST",
    mode:"no-cors",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify({action:"save",token:cfg.token,data:normalizeState(data)})
  });
}
function latestResultDetail(data){
  const safe=normalizeState(data);
  const latest=[...safe.results].sort((a,b)=>b.date.localeCompare(a.date))[0];
  if(!latest)return "Kết quả: chưa có dữ liệu.";
  return `Kết quả mới nhất: ngày ${displayDate(latest.date)} · ĐB ${latest.special} · ${latest.prizes?.length||0} giải.`;
}
function latestPredictionDetail(data){
  const safe=normalizeState(data);
  const latestDate=[...safe.entries].map(e=>e.date).sort((a,b)=>b.localeCompare(a))[0];
  if(!latestDate)return "Dự đoán: chưa có lượt dự đoán.";
  const dayEntries=safe.entries.filter(e=>e.date===latestDate);
  const memberParts=safe.members
    .filter(member=>dayEntries.some(e=>e.memberId===member.id))
    .map(member=>{
      const rows=buildPredictionSummaryRows(dayEntries.filter(e=>e.memberId===member.id));
      return `${member.name}: ${rows.map(row=>row.copy).join("; ")}`;
    });
  return `Dự đoán mới nhất: ngày ${displayDate(latestDate)} · ${dayEntries.length} lượt.\n${memberParts.join("\n")}`;
}
function cloudDetailMessage(action,data,updatedAt=""){
  return `${action}${updatedAt?` · Cloud cập nhật ${updatedAt}`:""}\n${latestPredictionDetail(data)}\n${latestResultDetail(data)}`;
}
async function checkCloudState(){
  if(!requireAdmin())return;
  setCloudStatus("Đang kiểm tra cloud...");
  try{
    const cloud=await fetchCloudDataForCheck(false);
    if(!cloud)return;
    const message=cloudDetailMessage("Đã kiểm tra cloud.",cloud.data,cloud.updatedAt);
    setCloudStatus(message);
  }catch(err){
    const message=`Kiểm tra cloud lỗi: ${err.message||err}`;
    setCloudStatus(message,false);
  }
}
async function loadCloudState(){
  if(!requireAdmin())return;
  setCloudStatus("Đang tải dữ liệu cloud...");
  try{
    const cloud=await fetchCloudDataForCheck(false);
    if(!cloud)return;
    const incoming=cloud.data;
    const label=`Cloud${cloud.updatedAt?` cập nhật ${cloud.updatedAt}`:""}`;
    if(!shouldReplaceLocalWith(incoming,label))return;
    makeLocalBackup("before-load-cloud");
    state=incoming;
    save();
    const message=cloudDetailMessage("Đã lấy cloud toàn bộ.",state,cloud.updatedAt);
    setCloudStatus(message);
    alert("Lấy cloud thành công.");
  }catch(err){
    const message=`Tải cloud lỗi: ${err.message||err}`;
    setCloudStatus(message,false);
  }
}
async function loadCloudForPlayer(){
  setCloudStatus("Đang tải cloud...");
  try{
    const cloud=await fetchCloudDataForCheck(true);
    if(!cloud)return;
    const incoming=cloud.data;
    const label=`Cloud${cloud.updatedAt?` cập nhật ${cloud.updatedAt}`:""}`;
    if(!shouldReplaceLocalWith(incoming,label))return;
    makeLocalBackup("before-player-load-cloud");
    state=incoming;
    currentPlayerId="";
    sessionStorage.removeItem("so-diem-vui-player");
    save();
    const message=`Đã tải cloud: ${stateStatsText(state)}. Chọn tên người chơi rồi nhập mật khẩu để vào.`;
    setCloudStatus(message);
    alert(message);
  }catch(err){
    const message=`Tải cloud lỗi: ${err.message||err}`;
    setCloudStatus(message,false);
    alert(message);
  }
}
async function saveCloudState(){
  if(!requireAdmin())return;
  if(!saveCloudConfig())return;
  if(!hasPlayerData(state)){
    if(!confirm(`Máy này chưa có người chơi/lượt dự đoán (${stateStatsText(state)}). Vẫn lưu lên cloud và ghi đè bản cloud hiện tại?`))return;
  }else if(!confirm(`Lưu dữ liệu máy này lên cloud (${stateStatsText(state)}) và ghi đè bản cloud hiện tại?`))return;
  const cfg=cloudConfig();
  setCloudStatus("Đang gửi dữ liệu lên cloud...");
  try{
    await postCloudState(state);
    setCloudStatus(cloudDetailMessage("Đã lưu cloud toàn bộ.",state));
    alert("Lưu cloud thành công.");
  }catch(err){
    setCloudStatus(`Lưu cloud lỗi: ${err.message||err}`,false);
  }
}
async function loadCloudPredictions(){
  if(!requireAdmin())return;
  setCloudStatus("Đang lấy cloud dự đoán...");
  try{
    const cloud=await fetchCloudDataForCheck(false);
    if(!cloud)return;
    const incoming=normalizeState(cloud.data);
    const mergedResults=mergeResultsByDate(incoming.results,state.results);
    makeLocalBackup("before-load-cloud-predictions");
    state=normalizeState({...state,members:incoming.members,entries:incoming.entries,results:mergedResults});
    save();
    setCloudStatus(`${cloudDetailMessage("Đã lấy cloud dự đoán.",state,cloud.updatedAt)}\nKết quả đã gộp theo ngày: ${mergedResults.length} ngày.`);
    alert("Lấy cloud dự đoán thành công.");
  }catch(err){
    setCloudStatus(`Lấy cloud dự đoán lỗi: ${err.message||err}`,false);
  }
}
async function saveCloudPredictions(){
  if(!requireAdmin())return;
  if(!saveCloudConfig())return;
  if(!confirm(`Lưu cloud dự đoán: đẩy ${state.members.length} người chơi và ${state.entries.length} lượt dự đoán lên cloud, giữ nguyên kết quả đang có trên cloud?`))return;
  setCloudStatus("Đang lưu cloud dự đoán...");
  try{
    const cloud=await fetchCloudDataForCheck(false);
    const cloudData=normalizeState(cloud?.data||EMPTY_STATE);
    const updatedAt=cloud?.updatedAt||"";
    const mergedResults=mergeResultsByDate(cloudData.results,state.results);
    const merged=normalizeState({
      members:state.members,
      entries:state.entries,
      results:mergedResults
    });
    await postCloudState(merged);
    setCloudStatus(`${cloudDetailMessage("Đã lưu cloud dự đoán.",{...state,results:merged.results},updatedAt)}\nKết quả đã gộp theo ngày: ${merged.results.length} ngày.`);
    alert("Lưu cloud dự đoán thành công.");
  }catch(err){
    setCloudStatus(`Lưu cloud dự đoán lỗi: ${err.message||err}`,false);
  }
}
async function copyPlayerCloudLink(){
  if(!requireAdmin())return;
  if(!saveCloudConfig())return;
  const cfg=cloudConfig();
  const url=new URL(location.href);
  url.hash="";
  url.searchParams.set("cloudUrl",cfg.url);
  url.searchParams.set("token",cfg.token);
  const link=url.toString();
  try{
    await navigator.clipboard.writeText(link);
    setCloudStatus("Đã copy link người chơi. Gửi link này để người chơi bấm Tải cloud.");
    alert("Đã copy link người chơi.");
  }catch{
    prompt("Copy link này gửi cho người chơi",link);
  }
}
async function sha256(text){
  const buf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function requireAdmin(){
  if(isAdmin)return true;
  alert("Cần đăng nhập QTV.");
  return false;
}
function currentPlayer(){
  return state.members.find(m=>m.id===currentPlayerId)||null;
}
function canViewAll(){
  return isAdmin;
}
function canUsePlayerData(){
  return isAdmin||!!currentPlayer();
}
function visibleMembers(){
  if(isAdmin)return state.members;
  const me=currentPlayer();
  return me?[me]:[];
}
function visibleEntries(entries=state.entries){
  if(isAdmin)return entries;
  const me=currentPlayer();
  return me?entries.filter(e=>e.memberId===me.id):[];
}
function canModifyEntry(entry){
  return isAdmin||!!currentPlayer()&&entry.memberId===currentPlayerId;
}
function requirePlayerOrAdmin(){
  if(canUsePlayerData())return true;
  alert("Hãy tải cloud và đăng nhập người chơi trước.");
  return false;
}
function renderAdminState(){
  $$(".admin-only").forEach(el=>el.classList.toggle("admin-hidden",!isAdmin));
  enforceAdminOnlySubtabs();
  $("#adminForm").classList.toggle("admin-hidden",isAdmin);
  if(isAdmin)fillCloudForm();
  renderPlayerSession();
}
function enforceAdminOnlySubtabs(){
  if(!isAdmin&&$(".tab.active")?.dataset.tab==="patterns"){
    const fallback=$('.tab[data-tab="stats"]');
    fallback?.classList.add("active");
    $('.tab[data-tab="patterns"]')?.classList.remove("active");
    $("#tab-patterns")?.classList.remove("active");
    $("#tab-stats")?.classList.add("active");
  }
}
function renderPlayerSession(){
  const me=currentPlayer();
  const playerForm=$("#playerLoginForm");
  const session=$("#playerSession");
  const register=$("#playerRegisterForm");
  if($("#playerLoginMember")){
    $("#playerLoginMember").innerHTML=state.members.length?
      state.members.map(m=>`<option value="${m.id}">${esc(m.name)}${m.passwordHash?"":" (chưa MK)"}</option>`).join(""):
      '<option value="">Chưa có người chơi</option>';
    if(me)$("#playerLoginMember").value=me.id;
  }
  if(playerForm)playerForm.classList.toggle("hidden",isAdmin||!!me);
  if(register)register.classList.toggle("hidden",isAdmin||!!me);
  if(session){
    session.classList.toggle("hidden",!isAdmin&&!me);
    session.innerHTML=isAdmin?
      '<strong>QTV xem tất cả</strong>':
      me?`<strong>${esc(me.name)}</strong><button type="button" onclick="logoutPlayer()">Thoát</button>`:"";
  }
}
function logoutPlayer(){
  currentPlayerId="";
  sessionStorage.removeItem("so-diem-vui-player");
  render();
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function displayDate(date){
  const m=String(date||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m?`${m[3]}/${m[2]}/${m[1]}`:esc(date||"");
}
function toInputDate(day,month,year){
  const d=String(day).padStart(2,"0");
  const m=String(month).padStart(2,"0");
  const y=String(year);
  const parsed=new Date(`${y}-${m}-${d}T00:00:00`);
  if(parsed.getFullYear()!==Number(y)||parsed.getMonth()+1!==Number(m)||parsed.getDate()!==Number(d))return "";
  return `${y}-${m}-${d}`;
}
function parseOcrDate(text){
  const match=String(text).match(/\b([0-3]?\d)[-/.\s]([01]?\d)[-/.\s](20\d{2})\b/);
  return match?toInputDate(match[1],match[2],match[3]):"";
}
function stripOcrDates(text){
  return String(text)
    .replace(/\b[0-3]?\d\s*[-/.\s]\s*[01]?\d\s*[-/.\s]\s*20\d{2}\b/g," ")
    .replace(/\b20\d{2}\s*[-/.]\s*[01]?\d\s*[-/.]\s*[0-3]?\d\b/g," ");
}
function two(v){return String(v).replace(/\D/g,"").slice(-2).padStart(2,"0")}
function normalizePrizes(text){
  return String(text).split(/\s+/).map(x=>x.replace(/\D/g,"")).filter(Boolean);
}
function parseQuickEntryLine(line){
  const text=String(line).trim().toLowerCase();
  if(!text)return null;
  const pointMatch=text.match(/(\d+(?:[.,]\d+)?)\s*(k|đ|d|điểm|diem)?\s*$/i);
  const looksLikeOpenHeadCommand=pointMatch&&!pointMatch[2]&&/(đầu|dau|đít|dit|đuôi|duoi)\s*$/i.test(text.slice(0,pointMatch.index).trim());
  const rawPoints=!looksLikeOpenHeadCommand&&pointMatch?.[1]?pointMatch[1].replace(",","."):"";
  let points=Number(rawPoints);
  const suffix=!looksLikeOpenHeadCommand&&pointMatch?.[2]?pointMatch[2]:"";
  const numberPart=pointMatch&&!looksLikeOpenHeadCommand?text.slice(0,pointMatch.index):text;
  if(numberPart.includes("đầu")||numberPart.includes("dau")){
    const heads=(numberPart.match(/\d/g)||[]).filter((n,i,a)=>a.indexOf(n)===i);
    if(!heads.length)return null;
    const numbers=heads.flatMap(head=>Array.from({length:10},(_,tail)=>`${head}${tail}`));
    const type=suffix==="k"?"de":"de";
    if(!Number.isFinite(points)||points<=0)points=10;
    const groupLabel=heads.map(head=>`${head}0 -> ${head}9`).join(", ");
    return {type,numbers,points,groupLabel};
  }
  if(numberPart.includes("đít")||numberPart.includes("dit")||numberPart.includes("đuôi")||numberPart.includes("duoi")){
    const tails=(numberPart.match(/\d/g)||[]).filter((n,i,a)=>a.indexOf(n)===i);
    if(!tails.length)return null;
    const numbers=numbersFromTails(tails);
    const type=suffix==="k"?"de":"de";
    if(!Number.isFinite(points)||points<=0)points=10;
    const groupLabel=tails.map(tail=>`0${tail} -> 9${tail}`).join(", ");
    return {type,numbers,points,groupLabel};
  }
  const numbers=(numberPart.match(/\d{1,2}/g)||[]).map(two).filter((n,i,a)=>a.indexOf(n)===i);
  if(!numbers.length)return null;
  const type=suffix==="k"?"de":suffix==="đ"||suffix==="d"||suffix==="điểm"||suffix==="diem"?"lo":$("#entryType").value;
  if(!Number.isFinite(points)||points<=0)points=type==="de"?10:1;
  return {type,numbers,points,groupLabel:""};
}
function quickEntryCost(type,numbers,points){
  const count=(numbers||[]).length;
  return type==="lo"?count*points*23:count*points;
}
function quickEntryCopyLinesFromRows(rows){
  return ["lo","de"].map(type=>{
    const typeRows=rows.filter(row=>row.dataset.type===type);
    if(!typeRows.length)return "";
    const title=type==="lo"?"Lô":"Đề";
    const suffix=type==="lo"?"đ":"k";
    return `${title}: `+typeRows.map(row=>{
      const numbers=String(row.dataset.numbers||"").split("-").filter(Boolean).join(" - ");
      const points=Math.max(0,Number(row.querySelector("[data-quick-points-input]")?.value)||0);
      return `${numbers} ${points}${suffix}`;
    }).join("; ");
  }).filter(Boolean);
}
function updateQuickEntryCopyPreview(){
  const target=document.querySelector("#quickEntryPreview [data-quick-copy-preview]");
  if(!target)return;
  const rows=[...document.querySelectorAll("#quickEntryPreview [data-quick-row]")];
  const total=document.querySelector("#quickEntryPreview [data-quick-cost]")?.textContent||"0";
  const lines=quickEntryCopyLinesFromRows(rows);
  target.innerHTML=lines.length?`${lines.map(line=>`<span>${esc(line)}</span>`).join("")}<strong>Tổng tiền trừ: ${esc(total)}k</strong>`:"";
}
function buildQuickEntryDraft(){
  const lines=$("#quickEntryText").value.split(/\r?\n|;/).map(x=>x.trim()).filter(Boolean);
  const rows=[],failed=[];
  lines.forEach(line=>{
    const parsed=parseQuickEntryLine(line);
    if(!parsed){failed.push(line);return}
    rows.push({...parsed,line});
  });
  return {rows,failed};
}
function renderQuickEntryPreview(){
  const target=$("#quickEntryPreview");
  if(!target)return {rows:[],failed:[]};
  const draft=buildQuickEntryDraft();
  if(!draft.rows.length){
    target.innerHTML="";
    $("#quickEntryStatus").textContent=draft.failed.length?`Chưa đọc được ${draft.failed.length} dòng.`:"Chưa có nội dung.";
    return draft;
  }
  const totalTurns=draft.rows.reduce((sum,row)=>sum+row.numbers.length,0);
  const totalPoints=draft.rows.reduce((sum,row)=>sum+row.numbers.length*row.points,0);
  const totalCost=draft.rows.reduce((sum,row)=>sum+quickEntryCost(row.type,row.numbers,row.points),0);
  const groupTotals={
    lo:{turns:0,cost:0},
    de:{turns:0,cost:0}
  };
  draft.rows.forEach(row=>{
    if(!groupTotals[row.type])return;
    groupTotals[row.type].turns+=row.numbers.length;
    groupTotals[row.type].cost+=quickEntryCost(row.type,row.numbers,row.points);
  });
  const renderGroup=type=>{
    const rows=draft.rows.filter(row=>row.type===type);
    const title=type==="lo"?"Lô":"Đề";
    const groupTurns=rows.reduce((sum,row)=>sum+row.numbers.length,0);
    const groupCost=rows.reduce((sum,row)=>sum+quickEntryCost(row.type,row.numbers,row.points),0);
    return `<div class="quick-draft-column ${type}">
      <div class="quick-draft-title"><strong>${title}</strong><span data-quick-group="${type}">${groupTurns} lượt · trừ ${groupCost}</span></div>
      ${rows.length?`<table class="quick-draft-table">
        <thead><tr><th>Dự đoán</th><th>Điểm/số</th><th>Trừ tiền</th></tr></thead>
        <tbody>${rows.map((row,index)=>`
          <tr data-quick-row data-type="${row.type}" data-numbers="${esc(row.numbers.join("-"))}" data-group-label="${esc(row.groupLabel||"")}">
            <td><strong>${row.numbers.join(" - ")} <span data-quick-row-points-label>${row.points}${row.type==="lo"?"đ":"k"}</span></strong><small>${esc(row.groupLabel||row.line)}</small></td>
            <td><input type="number" min="0" step="${row.type==="de"?10:1}" value="${row.points}" data-quick-points-input aria-label="Điểm ${title} dòng ${index+1}"></td>
            <td><span data-quick-row-cost>${quickEntryCost(row.type,row.numbers,row.points)}</span></td>
          </tr>`).join("")}</tbody>
      </table>`:`<p class="muted">Chưa có dòng ${title.toLowerCase()}.</p>`}
    </div>`;
  };
  target.innerHTML=`<div class="quick-preview-layout">
    <div class="quick-total-panel">
      <div><span>Lượt</span><strong data-quick-turns>${totalTurns}</strong></div>
      <div><span>Lô</span><strong data-quick-type-cost="lo">-${groupTotals.lo.cost}</strong></div>
      <div><span>Đề</span><strong data-quick-type-cost="de">-${groupTotals.de.cost}</strong></div>
      <div class="quick-total-money"><span>Tổng tiền trừ</span><strong><b data-quick-cost>${totalCost}</b>k</strong></div>
    </div>
    <div class="quick-draft-area">
      <div class="quick-preview-actions">
        <button id="quickCopyBtn" class="secondary" type="button">Copy</button>
        <button id="quickEntryBtn" type="button">Ghi nhanh</button>
      </div>
      <div class="quick-copy-preview" data-quick-copy-preview></div>
      <div class="quick-draft-columns">${renderGroup("lo")}${renderGroup("de")}</div>
    </div>
  </div>
  ${draft.failed.length?`<p class="quick-failed">Chưa đọc được: ${draft.failed.map(esc).join("; ")}</p>`:""}`;
  updateQuickEntryCopyPreview();
  $("#quickEntryStatus").textContent=`Đã tính ${totalTurns} lượt, tổng điểm ${totalPoints}, tiền trừ ${totalCost}.`;
  return draft;
}
function updateQuickEntryTotals(){
  const rows=[...document.querySelectorAll("#quickEntryPreview [data-quick-row]")];
  if(!rows.length)return;
  let totalTurns=0,totalPoints=0,totalCost=0;
  const groups={lo:{turns:0,cost:0},de:{turns:0,cost:0}};
  rows.forEach(row=>{
    const numbers=String(row.dataset.numbers||"").split("-").filter(Boolean);
    const points=Math.max(0,Number(row.querySelector("[data-quick-points-input]")?.value)||0);
    const cost=quickEntryCost(row.dataset.type,numbers,points);
    totalTurns+=numbers.length;
    totalPoints+=numbers.length*points;
    totalCost+=cost;
    if(groups[row.dataset.type]){
      groups[row.dataset.type].turns+=numbers.length;
      groups[row.dataset.type].cost+=cost;
    }
    const costNode=row.querySelector("[data-quick-row-cost]");
    if(costNode)costNode.textContent=String(cost);
    const pointsLabel=row.querySelector("[data-quick-row-points-label]");
    if(pointsLabel)pointsLabel.textContent=`${points}${row.dataset.type==="lo"?"đ":"k"}`;
  });
  const turnsNode=document.querySelector("#quickEntryPreview [data-quick-turns]");
  const pointsNode=document.querySelector("#quickEntryPreview [data-quick-points]");
  const costNode=document.querySelector("#quickEntryPreview [data-quick-cost]");
  if(turnsNode)turnsNode.textContent=String(totalTurns);
  if(pointsNode)pointsNode.textContent=String(totalPoints);
  if(costNode)costNode.textContent=String(totalCost);
  Object.entries(groups).forEach(([type,group])=>{
    const node=document.querySelector(`#quickEntryPreview [data-quick-group="${type}"]`);
    if(node)node.textContent=`${group.turns} lượt · trừ ${group.cost}`;
    const costSummary=document.querySelector(`#quickEntryPreview [data-quick-type-cost="${type}"]`);
    if(costSummary)costSummary.textContent=`-${group.cost}`;
  });
  updateQuickEntryCopyPreview();
  $("#quickEntryStatus").textContent=`Đã tính ${totalTurns} lượt, tổng điểm ${totalPoints}, tiền trừ ${totalCost}.`;
}
function copyQuickEntryPreview(){
  const rows=[...document.querySelectorAll("#quickEntryPreview [data-quick-row]")];
  if(!rows.length){
    $("#quickEntryStatus").textContent="Chưa có bảng để copy.";
    return;
  }
  const lines=quickEntryCopyLinesFromRows(rows);
  const total=document.querySelector("#quickEntryPreview [data-quick-cost]")?.textContent||"0";
  const text=[...lines,`Tổng tiền trừ: ${total}k`].join("\n");
  if(navigator.clipboard?.writeText){
    navigator.clipboard.writeText(text)
      .then(()=>{$("#quickEntryStatus").textContent="Đã copy bảng ghi nhanh.";})
      .catch(()=>prompt("Copy bảng ghi nhanh",text));
  }else{
    prompt("Copy bảng ghi nhanh",text);
  }
}
function quickSavedBatches(entries){
  const grouped=new Map();
  entries.forEach((entry,index)=>{
    const key=entry.batchCreatedAt&&entry.batchId?entry.batchId:`legacy-${entry.date}-${entry.memberId}`;
    if(!grouped.has(key))grouped.set(key,{key,createdAt:entry.batchCreatedAt||0,firstIndex:index,entries:[]});
    grouped.get(key).entries.push(entry);
  });
  return [...grouped.values()].sort((a,b)=>(a.createdAt||a.firstIndex)-(b.createdAt||b.firstIndex));
}
function quickSavedBatchSummary(entries){
  let totalPoints=0,loHits=0,deHits=0,cost=0,reward=0,pending=0;
  entries.forEach(entry=>{
    const c=calc(entry);
    totalPoints+=entry.points;
    cost+=c.cost;
    if(c.reward===null)pending++;
    else{
      reward+=c.reward;
      if(entry.type==="lo")loHits+=c.hits;
      else deHits+=c.hits;
    }
  });
  return {totalPoints,loHits,deHits,cost,reward,pending,net:reward-cost};
}
function renderQuickEntrySaved(){
  const target=$("#quickEntrySaved");
  if(!target)return;
  if(!canUsePlayerData()){
    target.innerHTML='<p class="muted">Đăng nhập người chơi để xem dữ liệu vừa ghi.</p>';
    return;
  }
  const date=$("#entryDate")?.value||today();
  const memberId=isAdmin?$("#entryMember")?.value:currentPlayerId;
  const entries=visibleEntries(state.entries)
    .filter(entry=>entry.date===date&&(!memberId||entry.memberId===memberId))
    .sort((a,b)=>(a.type==="lo"?0:1)-(b.type==="lo"?0:1)||b.points-a.points||a.number.localeCompare(b.number));
  if(!entries.length){
    target.innerHTML=`<div class="quick-saved-empty">Chưa có dữ liệu ghi cho ${displayDate(date)}.</div>`;
    return;
  }
  const batches=quickSavedBatches(entries);
  target.innerHTML=`<div class="quick-saved-head">
    <strong>Đã ghi ${displayDate(date)}</strong>
    <span>${batches.length} lần ghi · bấm vào từng dòng để xem cụ thể số điểm lô và đề</span>
  </div>
  <div class="table-wrap quick-saved-summary">
    <table>
      <thead><tr>
        <th>Lần</th><th>Ngày</th><th>Tổng số đánh</th><th>Tổng điểm dự đoán</th><th>Số lô đúng</th><th>Số đề đúng</th><th>Điểm trừ</th><th>Điểm cộng</th><th>Chênh lệch</th>
      </tr></thead>
      <tbody>
        ${batches.map((batch,index)=>{
          const total=quickSavedBatchSummary(batch.entries);
          const detailId=`quick-detail-${date.replace(/\D/g,"")}-${String(memberId||"all").replace(/\W/g,"")}-${String(batch.key).replace(/\W/g,"")}`;
          return `<tr class="summary-row" onclick="toggleDayDetail('${detailId}')">
            <td><strong>Lần ${index+1}</strong></td>
            <td><strong>${displayDate(date)}</strong>${total.pending?`<br><small class="pending">${total.pending} lượt chờ</small>`:""}</td>
            <td>${batch.entries.length}</td>
            <td>${total.totalPoints}</td>
            <td>${total.loHits}</td>
            <td>${total.deHits}</td>
            <td>${total.cost}</td>
            <td>${total.pending?"-":total.reward}</td>
            <td><span class="${total.pending?'pending':total.net>=0?'positive':'negative'}">${total.pending?"Chờ KQ":`${total.net>=0?'+':''}${total.net}`}</span></td>
          </tr>
          <tr id="${detailId}" class="detail-row">
            <td colspan="9">${renderEntryDetails(batch.entries)}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  </div>`;
}
function uniqueNumbers(numbers){
  return numbers.filter((number,index,all)=>all.indexOf(number)===index);
}
function numbersFromTails(tails){
  return tails.flatMap(tail=>Array.from({length:10},(_,head)=>`${head}${tail}`));
}
function parseManualNumberInput(text){
  const source=String(text||"");
  const normalized=source.toLowerCase();
  const groups=[];
  const numbers=[];
  const keywordPattern=/(đầu|dau|đít|dit|đuôi|duoi)\s*([\s\S]*?)(?=(?:đầu|dau|đít|dit|đuôi|duoi)|$)/gi;
  let matchedCommand=false;
  for(const match of normalized.matchAll(keywordPattern)){
    const keyword=match[1];
    const digits=uniqueNumbers(match[2].match(/\d/g)||[]);
    if(!digits.length)continue;
    matchedCommand=true;
    const isHead=keyword==="đầu"||keyword==="dau";
    const expanded=isHead
      ?digits.flatMap(head=>Array.from({length:10},(_,tail)=>`${head}${tail}`))
      :numbersFromTails(digits);
    numbers.push(...expanded);
    groups.push({
      type:isHead?"Đầu":"Đít",
      digits,
      numbers:expanded
    });
  }
  if(!matchedCommand){
    numbers.push(...[...source.matchAll(/\d{1,2}/g)].map(match=>two(match[0])));
  }
  return {numbers:uniqueNumbers(numbers),groups};
}
function parseManualNumbers(text){
  return parseManualNumberInput(text).numbers;
}
function renderManualInputSummary(parsed){
  if(!parsed.groups.length)return "";
  const groupHtml=parsed.groups.map(group=>`
    <div class="manual-input-group">
      <strong>${group.type} ${group.digits.join(" - ")}</strong>
      <span>${group.numbers.join(" ")}</span>
    </div>`).join("");
  return `<div class="manual-input-summary">
    <div><b>Đã bung ${parsed.numbers.length} số:</b> ${parsed.numbers.join(" - ")}</div>
    ${groupHtml}
  </div>`;
}
function manualNumberCandidates(numbers,autoRows,type){
  return numbers.map((number,index)=>{
    const matched=autoRows
      .filter(row=>row.target===type&&row.numbers?.includes(number))
      .sort((a,b)=>b.score-a.score||b.rate-a.rate||b.hit-a.hit)
      .slice(0,4);
    const score=matched.reduce((sum,row)=>sum+Math.max(0,row.score)+(row.rate*0.08),0);
    const bestRate=matched.reduce((max,row)=>Math.max(max,row.rate||0),0);
    const count=matched.length;
    const bestRule=matched[0];
    return {number,index,type,score,count,bestRate,bestRule};
  }).sort((a,b)=>b.score-a.score||b.bestRate-a.bestRate||b.count-a.count||a.index-b.index);
}
function latestManualAnalysisResult(){
  return stateCache.resultsDesc.find(result=>result?.special&&(result.prizes||[]).length)||null;
}
function buildManualNumberAnalysis(numbers){
  const baseResult=latestManualAnalysisResult();
  if(!baseResult)return {numbers,baseResult:null,autoRows:[],lo:[],de:[],loCandidates:[],deCandidates:[],allocation:null};
  const results=stateCache.results.filter(result=>result?.special&&(result.prizes||[]).length);
  const byDate=new Map(results.map(result=>[result.date,result]));
  const autoRows=buildAutoRowsForBase(baseResult,results,byDate);
  const mode=$("#referenceMode")?.value||"fun";
  const strong=mode==="strong";
  const loCandidates=manualNumberCandidates(numbers,autoRows,"lo");
  const deCandidates=manualNumberCandidates(numbers,autoRows,"db");
  const hasSignal=[...loCandidates,...deCandidates].some(x=>x.score>0||x.count>0);
  const loBudget=strong?360:180;
  const deBudget=strong?260:120;
  const lo=hasSignal?applyStakeBudget(loCandidates.filter(x=>x.score>0||x.count>0).slice(0,strong?6:4),"lo",loBudget):[];
  const de=hasSignal?applyStakeBudget(deCandidates.filter(x=>x.score>0||x.count>0).slice(0,strong?5:3),"de",deBudget):[];
  const allocation={
    lo,
    de,
    pool:[...new Set([...loCandidates,...deCandidates].filter(x=>x.score>0||x.count>0).map(x=>x.number))],
    confidence:referenceConfidence(autoRows.filter(row=>numbers.some(n=>row.numbers?.includes(n)))),
    mode:`Số tự chọn · ${strong?"Kết mạnh":"Đánh vui"}`,
    target:loBudget+deBudget,
    totalCost:referenceCost(lo,"lo")+referenceCost(de,"de"),
    forecastDate:addDate(baseResult.date,1)
  };
  allocation.signal=referenceSignal(allocation);
  const nextResult=byDate.get(allocation.forecastDate);
  allocation.performance=nextResult?evaluateReferencePerformance(allocation,nextResult):null;
  return {numbers,baseResult,autoRows,lo, de,loCandidates,deCandidates,allocation};
}
function renderManualAnalysisRows(candidates,picks,type){
  const stakeByNumber=new Map(picks.map(p=>[p.number,p.stake]));
  const rows=candidates.slice(0,8);
  if(!rows.length)return '<p class="muted">Chưa có số để phân tích.</p>';
  return `<div class="manual-analysis-list">${rows.map(row=>{
    const stake=stakeByNumber.get(row.number)||0;
    const rule=row.bestRule;
    const rate=rule?`${Math.round(rule.rate*100)}%`:"-";
    const sample=rule?`${rule.hit}/${rule.total}`:"chưa khớp rule";
    return `<div class="manual-analysis-row">
      <b>${row.number}</b>
      <span>${rate} · ${sample}${rule?` · ${esc(rule.name.replace(/^Từ [^:]+:\s*/,""))}`:""}</span>
      <em>${stake?`${stake}${type==="de"?"k":"đ"}`:"bỏ"}</em>
    </div>`;
  }).join("")}</div>`;
}
function renderManualNumberAnalysis(){
  const target=$("#analyzeNumbersResult");
  if(!target)return;
  const parsed=parseManualNumberInput($("#analyzeNumbersText").value);
  const numbers=parsed.numbers;
  if(!numbers.length){
    target.innerHTML='<p class="muted">Nhập vài số cần soi, ví dụ: đầu 1 - 3, đít 5 - 7 hoặc 05 13 67 76-31-50.</p>';
    return;
  }
  const analysis=buildManualNumberAnalysis(numbers);
  if(!analysis.baseResult){
    target.innerHTML='<p class="muted">Chưa có dữ liệu kết quả để soi xác suất.</p>';
    return;
  }
  const {baseResult,allocation}=analysis;
  const combinedText=combinedReferenceCopyText(analysis.lo,analysis.de);
  target.innerHTML=`<div class="manual-analysis-card">
    <div class="manual-analysis-head">
      <div><strong>Soi từ kết quả mới nhất ${displayDate(baseResult.date)}</strong>
        <small>ĐB ${esc(baseResult.special)} · ${(baseResult.prizes||[]).length} số kết quả</small>
        <div class="allocation-mode-switch">
          <button type="button" data-manual-mode="fun" class="${allocation.mode.includes('Đánh vui')?'active':''}">Đánh vui</button>
          <button type="button" data-manual-mode="strong" class="${allocation.mode.includes('Kết mạnh')?'active':''}">Kết mạnh</button>
        </div>
      </div>
      <div class="manual-analysis-actions"><small>Gợi ý cho ${displayDate(allocation.forecastDate)} · trừ ${allocation.totalCost} điểm</small>
        <button class="secondary" type="button" data-copy-all data-text="${esc(combinedText)}" onclick="copyReferenceText(this.dataset.text)">Copy cả lô + đề</button>
      </div>
    </div>
    ${renderManualInputSummary(parsed)}
    ${renderReferenceSignal(allocation.signal)}
    ${renderReferencePerformance(allocation.performance)}
    ${renderReferencePool(allocation.pool)}
    <div class="allocation-toolbar">
      <strong data-allocation-total>Gợi ý cho ${displayDate(allocation.forecastDate)} · trừ ${allocation.totalCost} điểm</strong>
      <div class="allocation-toolbar-actions">
        <div class="allocation-mode-switch">
          <button type="button" data-manual-mode="fun" class="${allocation.mode.includes('Đánh vui')?'active':''}">Đánh vui</button>
          <button type="button" data-manual-mode="strong" class="${allocation.mode.includes('Kết mạnh')?'active':''}">Kết mạnh</button>
        </div>
        <button class="secondary" type="button" data-copy-all data-text="${esc(combinedText)}" onclick="copyReferenceText(this.dataset.text)">Copy cả lô + đề</button>
      </div>
    </div>
    <div class="manual-analysis-horizontal">
      <div class="reference-grid">
        ${renderReferenceGroup("Lô phân bổ",analysis.lo,"lo",true)}
        ${renderReferenceGroup("Đề phân bổ",analysis.de,"de",true)}
      </div>
      <div class="manual-analysis-grid">
        <div class="manual-analysis-group">
          <h4>Lô nên ưu tiên</h4>
          ${renderManualAnalysisRows(analysis.loCandidates,analysis.lo,"lo")}
        </div>
        <div class="manual-analysis-group">
          <h4>Đề nên ưu tiên</h4>
          ${renderManualAnalysisRows(analysis.deCandidates,analysis.de,"de")}
        </div>
      </div>
    </div>
    <p class="manual-analysis-note">Số “bỏ” là số chưa khớp rule đủ tốt trong kho dữ liệu, nên giảm điểm hoặc loại để đỡ âm.</p>
  </div>`;
}
function refreshManualAnalysisIfOpen(){
  const input=$("#analyzeNumbersText");
  const target=$("#analyzeNumbersResult");
  if(!input?.value.trim()||!target?.innerHTML.trim())return;
  renderManualNumberAnalysis();
}
function memberName(id){return state.members.find(x=>x.id===id)?.name||"Đã xóa"}
function resultForDate(date){return stateCache.resultsByDate.get(date)}
function upsertResult(date,special,prizes){
  const existing=resultForDate(date);
  const result={id:existing?.id||uid(),date,special,prizes};
  state.results=state.results.filter(x=>x.date!==date);
  state.results.push(result);
  return Boolean(existing);
}
function parseCsv(text){
  const rows=[];
  let row=[],cell="",quoted=false;
  for(let i=0;i<String(text).length;i++){
    const ch=text[i],next=text[i+1];
    if(quoted){
      if(ch==="\""&&next==="\""){cell+="\"";i++}
      else if(ch==="\"")quoted=false;
      else cell+=ch;
    }else if(ch==="\"")quoted=true;
    else if(ch===","){row.push(cell);cell=""}
    else if(ch==="\n"){
      row.push(cell); rows.push(row);
      row=[]; cell="";
    }else if(ch!=="\r")cell+=ch;
  }
  if(cell||row.length){row.push(cell);rows.push(row)}
  return rows.filter(r=>r.some(c=>String(c).trim()));
}
function parseCsvDate(value){
  const s=String(value||"").trim();
  let m=s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if(m)return toInputDate(m[3],m[2],m[1]);
  m=s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if(m)return toInputDate(m[1],m[2],m[3]);
  return "";
}
function csvPrizeValue(value,kind){
  const raw=String(value??"").replace(/\D/g,"");
  if(!raw)return "";
  const size=kind==="special"||kind==="prize1"||kind==="prize2"||kind==="prize3"?5:
    kind==="prize4"||kind==="prize5"?4:
    kind==="prize6"?3:2;
  return raw.slice(-size).padStart(size,"0");
}
function csvPrizeKind(header){
  const h=String(header||"").toLowerCase();
  if(h==="special"||h.includes("db")||h.includes("dac"))return "special";
  const m=h.match(/prize(\d)/);
  return m?`prize${m[1]}`:"";
}
function importResultsFromCsv(text){
  const rows=parseCsv(text);
  if(rows.length<2)return {imported:0,updated:0,skipped:0};
  const headers=rows[0].map(h=>String(h).trim());
  const dateIndex=headers.findIndex(h=>/^date$|ngay|ngày/i.test(h));
  const specialIndex=headers.findIndex(h=>csvPrizeKind(h)==="special");
  const resultMap=new Map(state.results.map(r=>[r.date,r]));
  let imported=0,updated=0,skipped=0,latestDate="";
  rows.slice(1).forEach(cells=>{
    const date=parseCsvDate(cells[dateIndex]);
    if(!date){skipped++;return}
    let special=specialIndex>=0?csvPrizeValue(cells[specialIndex],"special"):"";
    const prizes=[];
    headers.forEach((header,i)=>{
      if(i===dateIndex)return;
      const kind=csvPrizeKind(header);
      if(!kind)return;
      const value=csvPrizeValue(cells[i],kind);
      if(value)prizes.push(value);
      if(kind==="special"&&value)special=value;
    });
    if(!special||prizes.length<27){skipped++;return}
    if(prizes[0]!==special){
      const idx=prizes.indexOf(special);
      if(idx>0)prizes.splice(idx,1);
      prizes.unshift(special);
    }
    const existing=resultMap.get(date);
    const result={id:existing?.id||uid(),date,special,prizes:prizes.slice(0,27)};
    resultMap.set(date,result);
    if(!latestDate||date>latestDate)latestDate=date;
    imported++;
    if(existing)updated++;
  });
  state.results=[...resultMap.values()];
  touchState();
  return {imported,updated,skipped,latestDate};
}

function loadResultIntoForm(date){
  const result=resultForDate(date);
  if(!result)return false;
  $("#specialPrize").value=result.special||"";
  $("#allPrizes").value=(result.prizes||[]).join(" ");
  setOcrStatus(`Đang sửa kết quả ngày ${displayDate(date)}. Bấm lưu sẽ ghi đè ngày này.`,"ok");
  return true;
}

function fileToDataUrl(file,done){
  const rd=new FileReader();
  rd.onload=()=>done(rd.result);
  rd.readAsDataURL(file);
}

function setOcrStatus(text,type=""){
  const el=$("#ocrStatus");
  el.className=`ocr-status ${type}`.trim();
  el.textContent=text;
}

function cleanOcrNumber(raw){
  return raw
    .replace(/[OQ]/gi,"0")
    .replace(/[IiLl|]/g,"1")
    .replace(/S/gi,"5")
    .replace(/B/gi,"8")
    .replace(/\D/g,"");
}

function isPrizeLabelToken(text,start,end,cleaned){
  const before=text.slice(Math.max(0,start-12),start).toLowerCase();
  const after=text.slice(end,Math.min(text.length,end+8)).toLowerCase();
  if(/[gq]\s*\.?\s*$/.test(before)&&cleaned.length===1)return true;
  if(/gi[ảa]i\s*$/.test(before)&&cleaned.length===1)return true;
  if(/^(nhất|nhi|nhì|ba|tư|tu|năm|nam|sáu|sau|bảy|bay)/i.test(after)&&cleaned.length===1)return true;
  return false;
}

function removePrizeLabelFromLine(line){
  let cleaned=String(line)
    .replace(/^\s*(?:[GgQ6]\s*\.?\s*(?:ĐB|DB|D8|[1-7])|Gi[ảa]i\s*(?:đặc\s*biệt|nhất|nhì|nhi|ba|tư|tu|năm|nam|sáu|sau|bảy|bay|[1-7]))\b[.:]?\s*/i,"");

  // OCR hay đọc "G.7" thành "6.7" hoặc "67"; chỉ xóa khi nó nằm ở đầu dòng nhãn giải.
  cleaned=cleaned.replace(/^\s*(?:6\s*[.]?\s*[1-7]|6[1-7])(?=\s+\d{2,5}\b)/,match=>{
    const rest=cleaned.slice(match.length);
    const restNumbers=rest.match(/\b\d{2,5}\b/g)||[];
    return restNumbers.length>=4?"":"67";
  });
  return cleaned;
}

function extractNumbersFromLine(line){
  const source=removePrizeLabelFromLine(line);
  return [...source.matchAll(/[0-9OQIiLl|SB](?:[.:-]?[0-9OQIiLl|SB]){1,4}/gi)]
    .map(match=>cleanOcrNumber(match[0]))
    .filter(x=>x.length>=2&&x.length<=5);
}

function extractLastPrizeNumbers(text){
  const lines=stripOcrDates(text).split(/\r?\n/);
  for(let i=lines.length-1;i>=0;i--){
    const line=lines[i];
    if(/(?:[GgQ6]\s*\.?\s*7|Gi[ảa]i\s*(?:7|bảy|bay))/i.test(line)){
      const nums=[
        ...extractNumbersFromLine(line),
        ...extractNumbersFromLine(lines[i+1]||""),
        ...extractNumbersFromLine(lines[i+2]||"")
      ].filter(x=>x.length===2);
      if(nums.length>=4)return nums.slice(0,4);
    }
  }
  return [];
}

function extractNumberTokens(text){
  const source=stripOcrDates(text)
    .split(/\r?\n/)
    .map(removePrizeLabelFromLine)
    .join("\n")
    .replace(/\b[Gg]\s*\.?\s*[1-7]\b/g," ")
    .replace(/\b[Qq6]\s*\.\s*[1-7]\b/g," ")
    .replace(/\b[Gg]i[ảa]i\s*(?:đặc\s*biệt|nhất|nhì|nhi|ba|tư|tu|năm|nam|sáu|sau|bảy|bay|[1-7])\b/gi," ");
  return [...source.matchAll(/[0-9OQIiLl|SB](?:[.:-]?[0-9OQIiLl|SB]){1,4}/gi)]
    .map(match=>({raw:match[0],start:match.index,end:match.index+match[0].length}))
    .map(token=>({...token,cleaned:cleanOcrNumber(token.raw)}))
    .filter(token=>token.cleaned.length>=2&&token.cleaned.length<=5)
    .filter(token=>!isPrizeLabelToken(text,token.start,token.end,token.cleaned))
    .map(token=>token.cleaned);
}

function prizeKindFromLine(line){
  const text=String(line).toLowerCase();
  if(/(?:đặc\s*biệt|g\s*\.?\s*(?:đb|db|d8))/.test(text))return "db";
  if(/(?:gi[ảa]i\s*nhất|g\s*\.?\s*1)\b/.test(text))return "g1";
  if(/(?:gi[ảa]i\s*(?:nhì|nhi)|g\s*\.?\s*2)\b/.test(text))return "g2";
  if(/(?:gi[ảa]i\s*ba|g\s*\.?\s*3)\b/.test(text))return "g3";
  if(/(?:gi[ảa]i\s*(?:tư|tu)|g\s*\.?\s*4)\b/.test(text))return "g4";
  if(/(?:gi[ảa]i\s*(?:năm|nam)|g\s*\.?\s*5)\b/.test(text))return "g5";
  if(/(?:gi[ảa]i\s*(?:sáu|sau)|g\s*\.?\s*6)\b/.test(text))return "g6";
  if(/(?:gi[ảa]i\s*(?:bảy|bay)|g\s*\.?\s*7|^6\s*\.?\s*7\b|^67\b)/.test(text))return "g7";
  return "";
}

function parsePrizeRows(text){
  const specs={
    db:{len:5,count:1},
    g1:{len:5,count:1},
    g2:{len:5,count:2},
    g3:{len:5,count:6},
    g4:{len:4,count:4},
    g5:{len:4,count:6},
    g6:{len:3,count:3},
    g7:{len:2,count:4}
  };
  const order=["db","g1","g2","g3","g4","g5","g6","g7"];
  const buckets=Object.fromEntries(order.map(key=>[key,[]]));
  let current="";
  stripOcrDates(text).split(/\r?\n/).forEach(line=>{
    const kind=prizeKindFromLine(line);
    if(kind)current=kind;
    if(!current)return;
    const spec=specs[current];
    extractNumbersFromLine(line)
      .filter(number=>number.length===spec.len)
      .forEach(number=>{
        if(buckets[current].length<spec.count)buckets[current].push(number);
      });
  });
  const complete=order.every(key=>buckets[key].length>=specs[key].count);
  if(!complete)return [];
  return order.flatMap(key=>buckets[key].slice(0,specs[key].count));
}

function parseLotteryText(text){
  const date=parseOcrDate(text);
  const expected=[5,5,5,5,5,5,5,5,5,5,4,4,4,4,4,4,4,4,4,4,3,3,3,2,2,2,2];
  const rowPrizes=parsePrizeRows(text);
  if(rowPrizes.length===27)return {date,special:rowPrizes[0]||"",prizes:rowPrizes};
  const tokens=extractNumberTokens(text);
  const lastPrize=extractLastPrizeNumbers(text);
  const firstFive=tokens.findIndex(x=>x.length===5);
  if(firstFive<0)return {date,special:"",prizes:[]};

  const prizes=[];
  let cursor=firstFive;
  expected.forEach(len=>{
    for(let i=cursor;i<tokens.length;i++){
      if(tokens[i].length===len){
        prizes.push(tokens[i]);
        cursor=i+1;
        return;
      }
    }
  });

  if(lastPrize.length===4){
    prizes.splice(23,4,...lastPrize);
  }

  if(prizes.length<8){
    const fallback=tokens.slice(firstFive).filter(x=>x.length>=2&&x.length<=5);
    return {date,special:fallback[0]||"",prizes:fallback};
  }
  return {date,special:prizes[0]||"",prizes};
}

async function readImageByOcr(image){
  const run=++ocrRun;
  if(!window.Tesseract){
    setOcrStatus("Chưa tải được OCR. Kiểm tra mạng rồi tải lại trang, hoặc nhập số thủ công.","warn");
    return;
  }
  try{
    setOcrStatus("Đang đọc ảnh kết quả...","busy");
    const res=await Tesseract.recognize(image,"eng",{
      logger:m=>{
        if(run!==ocrRun||!m.progress)return;
        const percent=Math.round(m.progress*100);
        if(m.status) setOcrStatus(`Đang đọc ảnh: ${percent}%`,"busy");
      }
    });
    if(run!==ocrRun)return;
    const parsed=parseLotteryText(res.data.text||"");
    if(parsed.date) $("#resultDate").value=parsed.date;
    if(parsed.special&&parsed.prizes.length){
      $("#specialPrize").value=parsed.special;
      $("#allPrizes").value=parsed.prizes.join(" ");
      const full=parsed.prizes.length===27;
      setOcrStatus(`${full?"Đã":"Mới"} đọc được ${parsed.prizes.length}/27 số${parsed.date?` cho ngày ${displayDate(parsed.date)}`:""}. ${full?"Bạn kiểm tra lại rồi bấm lưu kết quả.":"OCR đang thiếu số, kiểm tra đặc biệt dòng G.7 trước khi lưu."}`,full?"ok":"warn");
    }else{
      setOcrStatus("OCR chưa nhận ra dãy số rõ ràng. Bạn thử ảnh nét hơn hoặc nhập tay.","warn");
    }
  }catch(err){
    setOcrStatus("Không đọc được ảnh. Có thể OCR chưa tải xong hoặc trình duyệt chặn thư viện.","warn");
  }
}

function handleIncomingImage(image){
  pastedImage=image;
  renderResultPreview(image);
  readImageByOcr(image);
}

$$(".tab").forEach(btn=>btn.addEventListener("click",()=>{
  $$(".tab").forEach(x=>x.classList.toggle("active",x===btn));
  $$(".tab-panel").forEach(x=>x.classList.toggle("active",x.id===`tab-${btn.dataset.tab}`));
  render();
}));

$$(".subtab").forEach(btn=>btn.addEventListener("click",()=>{
  $$(".subtab").forEach(x=>x.classList.toggle("active",x===btn));
  $$(".subtab-panel").forEach(x=>x.classList.toggle("active",x.id===`stats-${btn.dataset.subtab}`));
  render();
}));

$("#adminForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const ok=await sha256($("#adminPassword").value)===ADMIN_HASH;
  $("#adminPassword").value="";
  if(!ok){alert("Sai mật khẩu QTV.");return}
  isAdmin=true;
  currentPlayerId="";
  sessionStorage.setItem("so-diem-vui-admin","1");
  sessionStorage.removeItem("so-diem-vui-player");
  render();
});
$("#adminLogout").addEventListener("click",()=>{
  isAdmin=false;
  sessionStorage.removeItem("so-diem-vui-admin");
  render();
});

$("#playerLoginForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const id=$("#playerLoginMember").value;
  const member=state.members.find(m=>m.id===id);
  if(!member){alert("Chưa chọn người chơi.");return}
  if(!member.passwordHash){alert("Người chơi này chưa có mật khẩu. Nhờ QTV đặt mật khẩu trước.");return}
  const ok=await sha256($("#playerLoginPassword").value)===member.passwordHash;
  $("#playerLoginPassword").value="";
  if(!ok){alert("Sai mật khẩu người chơi.");return}
  currentPlayerId=member.id;
  isAdmin=false;
  sessionStorage.setItem("so-diem-vui-player",currentPlayerId);
  sessionStorage.removeItem("so-diem-vui-admin");
  render();
});

$("#playerRegisterForm")?.addEventListener("submit",async e=>{
  e.preventDefault();
  const name=$("#playerName").value.trim();
  const password=$("#playerPassword").value;
  if(!name||password.length<4){alert("Tên và mật khẩu tối thiểu 4 ký tự.");return}
  const exists=state.members.some(m=>m.name.trim().toLowerCase()===name.toLowerCase());
  if(exists&&!confirm("Tên này đã có. Vẫn tạo thêm người chơi mới?"))return;
  const member={id:uid(),name,passwordHash:await sha256(password)};
  state.members.push(member);
  currentPlayerId=member.id;
  isAdmin=false;
  sessionStorage.setItem("so-diem-vui-player",currentPlayerId);
  sessionStorage.removeItem("so-diem-vui-admin");
  $("#playerName").value="";
  $("#playerPassword").value="";
  save();
});

$("#memberForm").addEventListener("submit",async e=>{
  e.preventDefault(); const name=$("#memberName").value.trim(); if(!name)return;
  if(!requireAdmin())return;
  const password=$("#memberPassword").value;
  state.members.push({id:uid(),name,passwordHash:password?await sha256(password):""});
  $("#memberName").value="";
  $("#memberPassword").value="";
  save();
});

$("#resultForm").addEventListener("submit",e=>{
  e.preventDefault();
  const date=$("#resultDate").value;
  const special=$("#specialPrize").value.replace(/\D/g,"");
  const prizes=normalizePrizes($("#allPrizes").value);
  if(!prizes.includes(special)) prizes.unshift(special);
  if(prizes.length!==27&&!confirm(`Danh sách hiện có ${prizes.length}/27 số. Bạn vẫn muốn lưu và ghi đè kết quả ngày ${displayDate(date)} không?`))return;
  const file=$("#resultImage").files[0];
  const commit=image=>{
    const overwritten=upsertResult(date,special,prizes);
    pastedImage="";
    $("#resultImage").value="";
    $("#resultSelect").value=date;
    $("#reportDate").value=date;
    setOcrStatus(`${overwritten?"Đã ghi đè":"Đã lưu"} kết quả ngày ${displayDate(date)}.`,"ok");
    save();
  };
  if(file) fileToDataUrl(file,commit);
  else commit(pastedImage);
});

$("#resultDate").addEventListener("change",e=>{
  if(!loadResultIntoForm(e.target.value)){
    $("#specialPrize").value="";
    $("#allPrizes").value="";
    setOcrStatus("Ngày này chưa có kết quả. Nhập mới hoặc dán ảnh để OCR.","");
  }
});

$("#resultImage").addEventListener("change",e=>{
  const file=e.target.files[0];
  if(file) fileToDataUrl(file,handleIncomingImage);
});

$("#entryForm")?.addEventListener("submit",e=>{
  e.preventDefault();
  if(!requirePlayerOrAdmin())return;
  const memberId=isAdmin?$("#entryMember").value:currentPlayerId;
  if(!memberId){alert("Chưa chọn người chơi.");return}
  state.entries.push({
    id:uid(),date:$("#entryDate").value,memberId,
    type:$("#entryType").value,number:two($("#entryNumber").value),
    points:Number($("#entryPoints").value)
  });
  $("#entryNumber").value=""; save();
});

$("#quickCalcBtn").addEventListener("click",renderQuickEntryPreview);
$("#quickEntryText").addEventListener("input",()=>{
  $("#quickEntryPreview").innerHTML="";
  $("#quickEntryStatus").textContent="";
});
$("#entryDate")?.addEventListener("change",renderQuickEntrySaved);
$("#entryMember")?.addEventListener("change",renderQuickEntrySaved);
$("#quickEntryPreview").addEventListener("input",event=>{
  if(event.target.matches("[data-quick-points-input]"))updateQuickEntryTotals();
});
$("#quickEntryPreview").addEventListener("click",event=>{
  if(event.target.id==="quickEntryBtn")commitQuickEntry();
  if(event.target.id==="quickCopyBtn")copyQuickEntryPreview();
});
function commitQuickEntry(){
  if(!requirePlayerOrAdmin())return;
  const date=$("#entryDate").value;
  const memberId=isAdmin?$("#entryMember").value:currentPlayerId;
  if(!memberId){alert("Chưa chọn người chơi.");return}
  if(!document.querySelectorAll("#quickEntryPreview [data-quick-row]").length)renderQuickEntryPreview();
  const rows=[...document.querySelectorAll("#quickEntryPreview [data-quick-row]")];
  if(!rows.length){
    $("#quickEntryStatus").textContent="Chưa có nội dung.";
    return;
  }
  let added=0;
  let addedPoints=0;
  const quickBatchId=uid();
  const quickBatchCreatedAt=Date.now();
  rows.forEach(row=>{
    const type=row.dataset.type;
    const numbers=String(row.dataset.numbers||"").split("-").filter(Boolean);
    const points=Math.max(0,Number(row.querySelector("[data-quick-points-input]")?.value)||0);
    if(!numbers.length||!points)return;
    const batchLabel=row.dataset.groupLabel||"";
    numbers.forEach(number=>{
      state.entries.push({id:uid(),date,memberId,type,number,points,batchId:quickBatchId,batchLabel,batchCreatedAt:quickBatchCreatedAt});
      added++;
      addedPoints+=points;
    });
  });
  if(added){
    $("#quickEntryText").value="";
    $("#quickEntryPreview").innerHTML="";
    save();
  }else render();
  $("#quickEntryStatus").textContent=`Đã thêm ${added} lượt, tổng điểm ${addedPoints}.`;
  renderQuickEntrySaved();
}
$("#analyzeNumbersBtn")?.addEventListener("click",renderManualNumberAnalysis);
$("#doubleBridgeStatsWeekSelect")?.addEventListener("change",()=>renderLongTermDoubleBridge("#statsLongTermDoubleBridge","#doubleBridgeStatsWeekSelect"));

$("#entryType")?.addEventListener("change",()=>{
  if($("#entryPoints"))$("#entryPoints").value=$("#entryType").value==="de"?10:1;
});
$("#filterDate").addEventListener("change",render);
$("#clearFilter").addEventListener("click",()=>{$("#filterDate").value="";render()});
$("#reportDate").addEventListener("change",render);
$("#clearReportDate").addEventListener("click",()=>{$("#reportDate").value=latestEntryDate(visibleEntries(state.entries));render()});
$("#resultStatsRange").addEventListener("change",renderResultStats);
$("#homeBtn")?.addEventListener("click",()=>{
  $$(".tab").forEach(btn=>btn.classList.toggle("active",btn.dataset.tab==="predict"));
  $$(".tab-panel").forEach(panel=>panel.classList.toggle("active",panel.id==="tab-predict"));
  window.scrollTo({top:0,behavior:"smooth"});
  render();
});
$("#jumpAdminLogin").addEventListener("click",()=>{
  document.querySelector(".admin-login-box")?.scrollIntoView({behavior:"smooth",block:"center"});
  setTimeout(()=>$("#adminPassword")?.focus(),350);
});
function updateFloatScrollButton(){
  const btn=$("#topBtn");
  if(!btn)return;
  const maxScroll=Math.max(0,document.documentElement.scrollHeight-window.innerHeight);
  const nearBottom=window.scrollY>Math.max(220,maxScroll*0.45);
  btn.textContent=nearBottom?"Top":"Bottom";
  btn.dataset.direction=nearBottom?"top":"bottom";
}
$("#topBtn").addEventListener("click",()=>{
  const direction=$("#topBtn").dataset.direction||"bottom";
  window.scrollTo({top:direction==="top"?0:document.documentElement.scrollHeight,behavior:"smooth"});
});
window.addEventListener("scroll",updateFloatScrollButton,{passive:true});
window.addEventListener("resize",updateFloatScrollButton);
$("#specialYear").addEventListener("change",renderSpecialStats);
$("#dbBridgeBaseDate").addEventListener("change",()=>{
  patternBaseState.dbbridge.manual=true;
  renderDbBridgeStats();
});
$("#patternYear").addEventListener("change",()=>{
  patternBaseState.forecast.manual=false;
  deferRender(renderForecastStats,"#forecastStats");
});
$("#patternBaseDate").addEventListener("change",()=>{
  patternBaseState.forecast.manual=true;
  deferRender(renderForecastStats,"#forecastStats");
});
$("#lawYear").addEventListener("change",()=>{
  patternBaseState.law.manual=false;
  deferRender(renderPatternStats,"#patternStats");
});
$("#lawBaseDate").addEventListener("change",()=>{
  patternBaseState.law.manual=true;
  deferRender(renderPatternStats,"#patternStats");
});
$("#lawReferenceMode").addEventListener("change",()=>{
  localStorage.setItem(LAW_MODE_KEY,$("#lawReferenceMode").value);
  deferRender(renderPatternStats,"#patternStats");
});
$("#lawBacktestMonth").addEventListener("change",()=>{
  localStorage.setItem(LAW_MONTH_KEY,$("#lawBacktestMonth").value);
  deferRender(renderPatternStats,"#patternStats");
});
$("#referenceMode").addEventListener("change",()=>{
  localStorage.setItem(REFERENCE_MODE_KEY,$("#referenceMode").value);
  deferRender(renderForecastStats,"#forecastStats");
});
$("#referenceBacktestMonth").addEventListener("change",()=>{
  localStorage.setItem(REFERENCE_MONTH_KEY,$("#referenceBacktestMonth").value);
  deferRender(renderForecastStats,"#forecastStats");
});
$("#resultSelect").addEventListener("change",()=>{
  renderResultPreview(null,true);
  renderHeadStats();
});
$("#closeResultModal").addEventListener("click",closeResultModal);
$("#resultModal").addEventListener("click",e=>{if(e.target.id==="resultModal")closeResultModal()});
$(".modal-panel").addEventListener("click",e=>e.stopPropagation());
$("#saveCloudConfig").addEventListener("click",saveCloudConfig);
$("#checkCloudData").addEventListener("click",checkCloudState);
$("#loadCloudData").addEventListener("click",loadCloudState);
$("#saveCloudData").addEventListener("click",saveCloudState);
$("#loadCloudPredictions").addEventListener("click",loadCloudPredictions);
$("#saveCloudPredictions").addEventListener("click",saveCloudPredictions);
$("#copyPlayerLink").addEventListener("click",copyPlayerCloudLink);
$("#playerLoadCloud").addEventListener("click",loadCloudForPlayer);
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeResultModal()});

const pasteZone=$("#pasteZone");
pasteZone.addEventListener("paste",e=>{
  const file=[...e.clipboardData.files].find(f=>f.type.startsWith("image/"));
  if(!file)return;
  e.preventDefault();
  fileToDataUrl(file,handleIncomingImage);
});
document.addEventListener("paste",e=>{
  const tag=document.activeElement?.tagName;
  if(tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT")return;
  const file=[...e.clipboardData.files].find(f=>f.type.startsWith("image/"));
  if(!file)return;
  e.preventDefault();
  fileToDataUrl(file,handleIncomingImage);
});
pasteZone.addEventListener("dragover",e=>{e.preventDefault();pasteZone.classList.add("active")});
pasteZone.addEventListener("dragleave",()=>pasteZone.classList.remove("active"));
pasteZone.addEventListener("drop",e=>{
  e.preventDefault();pasteZone.classList.remove("active");
  const file=[...e.dataTransfer.files].find(f=>f.type.startsWith("image/"));
  if(file) fileToDataUrl(file,handleIncomingImage);
});

function downloadJson(data,filename){
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

$("#exportBtn")?.addEventListener("click",()=>{
  if(!requireAdmin())return;
  const pack=exportDataPackage();
  makeLocalBackup("export-full-data");
  downloadJson(pack,`so-diem-vui-data-${today()}.json`);
  alert(`Đã export data: ${stateStatsText(pack.data)}. File này có cả cấu hình cloud/mode test.`);
});
$("#exportDataBtn").addEventListener("click",()=>{
  if(!requireAdmin())return;
  const pack=exportDataPackage();
  makeLocalBackup("export-data");
  downloadJson(pack,`so-diem-vui-data-${today()}.json`);
  alert(`Đã export data: ${stateStatsText(pack.data)}. File này có cả cấu hình cloud/mode test.`);
});
$("#exportResultsBtn").addEventListener("click",()=>{
  if(!requireAdmin())return;
  downloadJson({exportedAt:new Date().toISOString(),results:state.results},`ket-qua-xsmb-${today()}.json`);
});
$("#importCsvBtn").addEventListener("click",async()=>{
  if(!requireAdmin())return;
  if(!confirm("Import kết quả XSMB từ file CSV GitHub? Ngày trùng sẽ được ghi đè."))return;
  const btn=$("#importCsvBtn");
  const oldText=btn.textContent;
  btn.disabled=true;
  btn.textContent="Đang tải";
  try{
    const res=await fetch(XSMB_CSV_URL,{cache:"no-store"});
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    const stats=importResultsFromCsv(await res.text());
    if(!stats.imported){
      alert("Không đọc được dòng kết quả nào từ CSV.");
      return;
    }
    if(stats.latestDate)$("#reportDate").value=stats.latestDate;
    if(stats.latestDate)$("#resultSelect").value=stats.latestDate;
    save();
    alert(`Đã import ${stats.imported} ngày. Ghi đè ${stats.updated} ngày trùng. Bỏ qua ${stats.skipped} dòng lỗi.`);
  }catch(err){
    alert(`Không tải được CSV. Kiểm tra mạng rồi thử lại.\n${err.message||err}`);
  }finally{
    btn.disabled=false;
    btn.textContent=oldText;
  }
});
$("#importDataFile").addEventListener("change",e=>{
  if(!requireAdmin()){e.target.value="";return}
  const f=e.target.files[0]; if(!f)return;
  const rd=new FileReader();
  rd.onload=()=>{
    try{
      const pack=unpackImportedData(rd.result);
      if(!shouldReplaceLocalWith(pack.data,`${pack.label} ${f.name}`))return;
      makeLocalBackup("before-import-data");
      state=pack.data;
      if(pack.config)applyAppConfig(pack.config);
      save();
      alert(`Đã import data: ${stateStatsText(state)}${pack.config?" và cấu hình.":"."}`);
    }catch(err){
      alert(`File data không hợp lệ: ${err.message||err}`);
    }finally{
      e.target.value="";
    }
  };
  rd.readAsText(f);
});
$("#importFile")?.addEventListener("change",e=>{
  if(!requireAdmin()){e.target.value="";return}
  const f=e.target.files[0]; if(!f)return;
  const rd=new FileReader();
  rd.onload=()=>{
    try{
      const pack=unpackImportedData(rd.result);
      const incoming=pack.data;
      if(!shouldReplaceLocalWith(incoming,`${pack.label} ${f.name}`))return;
      makeLocalBackup("before-import-file");
      state=incoming;
      if(pack.config)applyAppConfig(pack.config);
      save();
      alert(`Đã nhập file: ${stateStatsText(state)}${pack.config?" và cấu hình.":"."}`);
    }catch{
      alert("File dữ liệu không hợp lệ.");
    }finally{
      e.target.value="";
    }
  };
  rd.readAsText(f);
});
$("#restoreBackupBtn").addEventListener("click",restoreLatestBackup);

function calc(entry){
  const r=resultForDate(entry.date);
  if(entry.type==="lo"){
    const cost=entry.points*23;
    if(!r)return {hits:null,cost,reward:null,net:null,matches:[]};
    const matches=r.prizes.filter(x=>two(x)===entry.number);
    const hits=matches.length;
    const reward=hits*entry.points*80;
    return {hits,cost,reward,net:reward-cost,matches};
  }
  const cost=entry.points;
  if(!r)return {hits:null,cost,reward:null,net:null,matches:[]};
  const hit=two(r.special)===entry.number?1:0;
  const reward=hit*entry.points*80;
  return {hits:hit,cost,reward,net:reward-cost,matches:hit?[r.special]:[]};
}

function hitLabel(entry,calcResult){
  if(calcResult.hits===null)return "-";
  if(entry.type==="de")return calcResult.hits?"Trúng":"Trượt";
  if(calcResult.hits)return `${calcResult.hits} lần · <span class="hit-number">${esc(entry.number)}</span> (${calcResult.matches.map(esc).join(", ")})`;
  return `0 lần - không thấy ${entry.number}`;
}

function removeMember(id){
  if(!requireAdmin())return;
  if(!confirm("Xóa thành viên và các lượt liên quan?"))return;
  state.members=state.members.filter(x=>x.id!==id);
  state.entries=state.entries.filter(x=>x.memberId!==id);save()
}
async function editMember(id){
  if(!requireAdmin())return;
  const member=state.members.find(x=>x.id===id);
  if(!member)return;
  const name=prompt("Tên mới",member.name);
  if(!name||!name.trim())return;
  member.name=name.trim();
  save();
}
async function setMemberPassword(id){
  if(!requireAdmin())return;
  const member=state.members.find(x=>x.id===id);
  if(!member)return;
  const password=prompt(`Đặt mật khẩu mới cho ${member.name}`, "");
  if(!password)return;
  if(password.trim().length<4){alert("Mật khẩu tối thiểu 4 ký tự.");return}
  member.passwordHash=await sha256(password.trim());
  save();
  alert(`Đã đặt mật khẩu cho ${member.name}.`);
}
function removeEntry(id){
  const entry=state.entries.find(x=>x.id===id);
  if(!entry||!canModifyEntry(entry)){alert("Bạn không có quyền xóa lượt này.");return}
  state.entries=state.entries.filter(x=>x.id!==id);save()
}
function removeEntries(ids){
  const set=new Set(String(ids).split(","));
  const selected=state.entries.filter(x=>set.has(x.id));
  if(selected.some(x=>!canModifyEntry(x))){alert("Bạn không có quyền xóa một số lượt trong nhóm này.");return}
  state.entries=state.entries.filter(x=>!set.has(x.id));save();
}
function removeEntriesByDate(date){
  if(!confirm(`Xóa toàn bộ lượt dự đoán ngày ${displayDate(date)}?`))return;
  state.entries=state.entries.filter(x=>x.date!==date||!canModifyEntry(x));save();
}
window.removeMember=removeMember; window.editMember=editMember; window.setMemberPassword=setMemberPassword; window.removeEntry=removeEntry; window.removeEntries=removeEntries; window.removeEntriesByDate=removeEntriesByDate; window.logoutPlayer=logoutPlayer;

function aggregate(entries){
  return entries.reduce((sum,e)=>{
    const c=calc(e);
    sum.count++;
    sum.cost+=c.cost;
    if(c.reward===null) sum.pending++;
    else {
      sum.reward+=c.reward;
      sum.hits+=c.hits;
      sum.done++;
    }
    return sum;
  },{count:0,done:0,pending:0,hits:0,cost:0,reward:0});
}

function selectedResult(){
  const sorted=stateCache.resultsDesc;
  if(!sorted.length)return null;
  const current=$("#resultSelect").value;
  return sorted.find(r=>r.date===current)||
    sorted[0];
}

function headCounts(result){
  const counts=Array.from({length:10},()=>0);
  (result?.prizes||[]).forEach(prize=>{
    const number=two(prize);
    const head=Number(number[0]);
    if(!Number.isNaN(head)) counts[head]++;
  });
  return counts;
}

function lotoNumbers(result){
  return (result?.prizes||[]).map(prize=>two(prize));
}

function renderMembers(){
  const members=visibleMembers();
  const selectedMember=$("#entryMember")?.value||"";
  if(!isAdmin&&!currentPlayer()){
    $("#memberList").innerHTML='<p class="muted">Đăng nhập QTV để quản lý người chơi.</p>';
    $("#entryMember").innerHTML='<option value="">Đăng nhập trước</option>';
    $("#entryMember").disabled=true;
    return;
  }
  $("#memberList").innerHTML=members.length?members.map(m=>`
    <div class="member"><strong>${esc(m.name)}</strong>
    <small>${m.passwordHash?"Có mật khẩu":"Chưa có mật khẩu"}</small>
    <span class="member-actions admin-only">
      <button class="secondary" type="button" onclick="editMember('${m.id}')">Sửa</button>
      <button class="secondary" type="button" onclick="setMemberPassword('${m.id}')">Đặt MK</button>
      <button class="danger" type="button" onclick="removeMember('${m.id}')">Xóa</button>
    </span></div>`).join(""):
    '<p class="muted">Chưa có thành viên.</p>';
  $("#entryMember").innerHTML=members.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join("");
  if(members.some(m=>m.id===selectedMember))$("#entryMember").value=selectedMember;
  $("#entryMember").disabled=!isAdmin;
}

function isSaturday(date){
  const [year,month,day]=String(date).split("-").map(Number);
  return new Date(year,month-1,day).getDay()===6;
}

function doublePairsFromPrize(prize){
  const source=two(prize);
  return [...new Set([`${source[0]}${source[0]}`,`${source[1]}${source[1]}`])];
}

function buildLongTermDoubleBacktest(){
  const dayNames=["Chủ nhật mở tuần","Thứ Hai","Thứ Ba","Thứ Tư","Thứ Năm","Thứ Sáu","Thứ Bảy","Chủ nhật cuối tuần"];
  const rows=dayNames.map((day,index)=>({day,index,samples:0,any:0,both:0,first:0,second:0}));
  stateCache.results
    .filter(result=>isSaturday(result.date)&&result.prizes?.length>=26)
    .forEach(saturday=>{
      const pairs=doublePairsFromPrize(saturday.prizes[25]);
      rows.forEach((row,index)=>{
        const result=stateCache.resultsByDate.get(addDate(saturday.date,index+1));
        if(!result)return;
        const drawn=new Set(lotoNumbers(result));
        const hits=pairs.map(pair=>drawn.has(pair));
        row.samples++;
        if(hits.some(Boolean))row.any++;
        if(pairs.length===2&&hits.every(Boolean))row.both++;
        if(hits[0])row.first++;
        if(hits[1])row.second++;
      });
    });
  return rows;
}

function percent(hit,total){
  return total?`${Math.round(hit/total*100)}%`:"-";
}

function buildDoubleBreakEvenPlan(backtest){
  let previousStakeTotal=0;
  let cumulativeCost=0;
  return backtest.map(row=>{
    // Hai cặp cùng điểm: chi phí ngày = 2 * 23 * điểm. Một cặp về = 80 * điểm.
    const stake=Math.max(1,Math.ceil((46*previousStakeTotal)/34));
    const dayCost=stake*46;
    cumulativeCost+=dayCost;
    const oneHitReward=stake*80;
    const oneHitNet=oneHitReward-cumulativeCost;
    previousStakeTotal+=stake;
    return {...row,stake,dayCost,cumulativeCost,oneHitReward,oneHitNet};
  });
}

function buildFixedDoublePlan(saturday,dayRows,stake=3,remainingStake=3,progression="double"){
  const pairs=doublePairsFromPrize(saturday.prizes[25]);
  const completedPairs=new Set();
  let stopped=false,totalCost=0,totalReward=0,remainingMisses=0;
  const rows=dayRows.map((day,index)=>{
    const date=addDate(saturday.date,index+1);
    const activePairs=pairs.filter(pair=>!completedPairs.has(pair));
    if(stopped)return {...day,date,status:"stopped",cost:0,reward:0,net:0,hitPairs:[],occurrences:0,activePairs:[]};
    const inRemainingPhase=completedPairs.size>0;
    const stakeUsed=inRemainingPhase?(progression==="double"?remainingStake*(2**remainingMisses):progression==="increase"?remainingStake*(remainingMisses+1):remainingStake):stake;
    const result=stateCache.resultsByDate.get(date);
    if(!result)return {...day,date,status:"pending",cost:0,reward:0,net:0,hitPairs:[],occurrences:0,activePairs,stakeUsed};
    const numbers=lotoNumbers(result);
    const pairHits=activePairs.map(pair=>({pair,count:numbers.filter(number=>number===pair).length}));
    const occurrences=pairHits.reduce((sum,item)=>sum+item.count,0);
    const hitPairs=pairHits.filter(item=>item.count).map(item=>`${item.pair}${item.count>1?` ×${item.count}`:""}`);
    pairHits.filter(item=>item.count).forEach(item=>completedPairs.add(item.pair));
    const cost=activePairs.length*stakeUsed*23;
    const reward=occurrences*stakeUsed*80;
    totalCost+=cost;
    totalReward+=reward;
    if(inRemainingPhase&&!occurrences)remainingMisses++;
    if(completedPairs.size===pairs.length||(completedPairs.size>0&&remainingStake===0))stopped=true;
    return {...day,date,status:occurrences?"hit":"miss",cost,reward,net:reward-cost,hitPairs,occurrences,activePairs,completedCount:completedPairs.size,stakeUsed};
  });
  return {pairs,stake,remainingStake,progression,rows,totalCost,totalReward,net:totalReward-totalCost,stopped,completedPairs:[...completedPairs]};
}

function setDoubleBridgeAfterHitMode(value){
  const points=Math.max(0,Number(value)||0);
  localStorage.setItem("double-bridge-remaining-stake",String(points));
  renderAllLongTermDoubleBridge();
}
window.setDoubleBridgeAfterHitMode=setDoubleBridgeAfterHitMode;
function setDoubleBridgeProgression(value){
  localStorage.setItem("double-bridge-progression",value);
  renderAllLongTermDoubleBridge();
}
window.setDoubleBridgeProgression=setDoubleBridgeProgression;
function setDoubleBridgeStatsRange(value){
  localStorage.setItem("double-bridge-stats-range",value);
  renderAllLongTermDoubleBridge();
}
window.setDoubleBridgeStatsRange=setDoubleBridgeStatsRange;
function setDoubleBridgeStatsPeriod(value){
  const range=localStorage.getItem("double-bridge-stats-range")||"month";
  localStorage.setItem(`double-bridge-stats-period-${range}`,value);
  renderAllLongTermDoubleBridge();
}
window.setDoubleBridgeStatsPeriod=setDoubleBridgeStatsPeriod;
function renderAllLongTermDoubleBridge(){
  renderLongTermDoubleBridge("#statsLongTermDoubleBridge","#doubleBridgeStatsWeekSelect");
}

function renderLongTermDoubleBridge(targetSelector="#longTermDoubleBridge",selectSelector="#doubleBridgeWeekSelect"){
  const target=$(targetSelector);
  if(!target)return;
  const select=$(selectSelector);
  const saturdays=stateCache.resultsDesc.filter(result=>isSaturday(result.date)&&result.prizes?.length>=26);
  if(!saturdays.length){
    if(select)select.innerHTML='<option value="">Chưa có tuần đủ dữ liệu</option>';
    target.innerHTML='<p class="muted">Chưa có kết quả thứ Bảy đủ Giải 7 để tạo cầu.</p>';
    return;
  }
  const selectedDate=select?.value;
  if(select){
    select.innerHTML=saturdays.map((result,index)=>{
      const pairs=doublePairsFromPrize(result.prizes[25]);
      return `<option value="${result.date}">${index===0?"Mới nhất · ":""}${displayDate(result.date)} · ${pairs.join("-")}</option>`;
    }).join("");
    select.value=saturdays.some(result=>result.date===selectedDate)?selectedDate:saturdays[0].date;
  }
  const saturday=saturdays.find(result=>result.date===(select?.value||selectedDate))||saturdays[0];
  const rawPrize=String(saturday.prizes[25]||"");
  const pairs=doublePairsFromPrize(rawPrize);
  const weekStart=addDate(saturday.date,1);
  const weekEnd=addDate(saturday.date,8);
  const backtest=buildLongTermDoubleBacktest();
  const breakEvenPlan=buildDoubleBreakEvenPlan(backtest);
  const latestSaturday=saturdays[0];
  const savedRemainingStake=Number(localStorage.getItem("double-bridge-remaining-stake")??3);
  const remainingStake=Number.isFinite(savedRemainingStake)?Math.max(0,savedRemainingStake):3;
  const progression=["double","increase","fixed"].includes(localStorage.getItem("double-bridge-progression"))?localStorage.getItem("double-bridge-progression"):"double";
  const fixedPlan=buildFixedDoublePlan(saturday,backtest,3,remainingStake,progression);
  const historicalFixedPlans=saturdays.map(source=>{
    const complete=backtest.every((_,index)=>stateCache.resultsByDate.has(addDate(source.date,index+1)));
    if(!complete)return null;
    const plan=buildFixedDoublePlan(source,backtest,3,remainingStake,progression);
    return {source,plan,start:addDate(source.date,1),end:addDate(source.date,8)};
  }).filter(Boolean);
  const historicalTotals=historicalFixedPlans.reduce((total,item)=>{
    total.cost+=item.plan.totalCost;
    total.reward+=item.plan.totalReward;
    total.net+=item.plan.net;
    if(item.plan.net>0)total.positive++;
    else if(item.plan.net<0)total.negative++;
    else total.even++;
    if(item.plan.completedPairs.length>=1)total.first++;
    if(item.plan.completedPairs.length===item.plan.pairs.length)total.both++;
    return total;
  },{cost:0,reward:0,net:0,positive:0,negative:0,even:0,first:0,both:0});
  const fixedStart=addDate(saturday.date,1);
  const fixedEnd=addDate(saturday.date,8);
  const statsRange=["month","quarter","year"].includes(localStorage.getItem("double-bridge-stats-range"))?localStorage.getItem("double-bridge-stats-range"):"month";
  const [defaultStatsYear,defaultStatsMonth]=saturdays[0].date.split("-").map(Number);
  const defaultStatsQuarter=Math.floor((defaultStatsMonth-1)/3)+1;
  const defaultStatsPeriod=statsRange==="month"?`${defaultStatsYear}-${String(defaultStatsMonth).padStart(2,"0")}`:statsRange==="quarter"?`${defaultStatsYear}-Q${defaultStatsQuarter}`:String(defaultStatsYear);
  const statsPeriod=localStorage.getItem(`double-bridge-stats-period-${statsRange}`)||defaultStatsPeriod;
  const periodMatch=statsPeriod.match(/^(\d{4})(?:-(\d{2})|-Q([1-4]))?$/);
  const statsYear=Number(periodMatch?.[1])||defaultStatsYear;
  const statsMonth=statsRange==="month"?(Number(periodMatch?.[2])||defaultStatsMonth):1;
  const statsQuarter=statsRange==="quarter"?Math.max(0,(Number(periodMatch?.[3])||defaultStatsQuarter)-1):0;
  const statsStart=statsRange==="year"?`${statsYear}-01-01`:statsRange==="quarter"?`${statsYear}-${String(statsQuarter*3+1).padStart(2,"0")}-01`:`${statsYear}-${String(statsMonth).padStart(2,"0")}-01`;
  const statsEnd=statsRange==="year"?`${statsYear}-12-31`:statsRange==="quarter"?addDate(localDate(new Date(statsYear,statsQuarter*3+3,1)),-1):addDate(localDate(new Date(statsYear,statsMonth,1)),-1);
  const statsYears=[...new Set(saturdays.map(source=>source.date.slice(0,4)))].sort((a,b)=>b.localeCompare(a));
  const statsPeriodControl=statsRange==="month"?`<input type="month" value="${statsPeriod}" onchange="setDoubleBridgeStatsPeriod(this.value)">`:statsRange==="quarter"?`<select onchange="setDoubleBridgeStatsPeriod(this.value)">${statsYears.flatMap(year=>[4,3,2,1].map(quarter=>`<option value="${year}-Q${quarter}" ${statsPeriod===`${year}-Q${quarter}`?'selected':''}>Quý ${quarter}/${year}</option>`)).join("")}</select>`:`<select onchange="setDoubleBridgeStatsPeriod(this.value)">${statsYears.map(year=>`<option value="${year}" ${statsPeriod===year?'selected':''}>Năm ${year}</option>`).join("")}</select>`;
  const periodPlans=saturdays.filter(source=>source.date>=statsStart&&source.date<=statsEnd)
    .map(source=>({source,plan:buildFixedDoublePlan(source,backtest,3,remainingStake,progression)}))
    .filter(item=>item.plan.rows.some(row=>row.status!=="pending"&&row.status!=="stopped"));
  const periodTotal=periodPlans.reduce((total,item)=>({cost:total.cost+item.plan.totalCost,reward:total.reward+item.plan.totalReward,net:total.net+item.plan.net}),{cost:0,reward:0,net:0});
  const bestDay=[...backtest].filter(row=>row.samples).sort((a,b)=>(b.any/b.samples)-(a.any/a.samples)||b.samples-a.samples)[0];
  const weekTracking=backtest.map((row,index)=>{
    const date=addDate(saturday.date,index+1);
    const result=stateCache.resultsByDate.get(date);
    if(!result)return {...row,date,status:"pending",hitPairs:[]};
    const drawn=new Set(lotoNumbers(result));
    const hitPairs=pairs.filter(pair=>drawn.has(pair));
    return {...row,date,status:hitPairs.length?"hit":"miss",hitPairs};
  });
  target.innerHTML=`<div class="long-term-bridge-result">
    <div class="bridge-source">
      <span>Nguồn cầu</span>
      <strong>Thứ Bảy ${displayDate(saturday.date)}</strong>
      <small>Giải 7 · cặp thứ 3: ${esc(rawPrize)}</small>
    </div>
    <div class="bridge-arrow">→</div>
    <div class="bridge-pick">
      <span>Hai cặp kép cả tuần</span>
      <strong>${pairs.join(" · ")}</strong>
      <small>${displayDate(weekStart)} – ${displayDate(weekEnd)}</small>
    </div>
    <button class="secondary" type="button" data-text="${pairs.join("-")}" onclick="copyReferenceText(this.dataset.text)">Copy ${pairs.join("-")}</button>
  </div>
  <div class="bridge-backtest-head hidden-bridge-extra"><strong>Theo dõi tuần ${displayDate(weekStart)} – ${displayDate(weekEnd)}</strong></div>
  <div class="table-wrap bridge-week-tracking"><table>
    <thead><tr><th>Ngày</th><th>Thời gian</th><th>Kết quả hai cặp kép ${pairs.join(" - ")}</th></tr></thead>
    <tbody>${weekTracking.map(row=>`<tr class="${row.status==='hit'?'double-hit-row':''}">
      <td><strong>${row.day}</strong></td><td>${displayDate(row.date)}</td>
      <td>${row.status==="pending"?'<span class="pending">Chờ KQ</span>':row.status==="hit"?`<strong class="double-hit-label">ĐÃ VỀ ${row.hitPairs.join(" - ")}</strong>`:'<span class="muted">Chưa về</span>'}</td>
    </tr>`).join("")}</tbody>
  </table></div>
  <div class="bridge-fixed-heading">
    <div><strong>${saturday.date===latestSaturday.date?"Tuần mới nhất":"Tuần kiểm tra"}: mỗi cặp 3 điểm</strong><span>${fixedPlan.pairs.join(" - ")} · ${displayDate(fixedStart)} – ${displayDate(fixedEnd)}</span></div>
    <div class="bridge-strategy-row">
      <strong>Sau khi cặp đầu về</strong>
      <div class="bridge-strategy-controls">
        <label><span>Đánh cặp còn lại</span>
          <span class="bridge-points-input"><input type="number" min="0" step="1" value="${remainingStake}" onchange="setDoubleBridgeAfterHitMode(this.value)"><b>điểm gốc</b></span>
        </label>
        <label><span>Cách đi điểm</span>
          <select onchange="setDoubleBridgeProgression(this.value)">
            <option value="double" ${progression==="double"?'selected':''}>Gấp thếp ×2</option>
            <option value="increase" ${progression==="increase"?'selected':''}>Tăng đều +${remainingStake}đ</option>
            <option value="fixed" ${progression==="fixed"?'selected':''}>Giữ nguyên</option>
          </select>
        </label>
        <small>${remainingStake?`Điểm cặp còn lại sẽ ${progression==="double"?`đi ${remainingStake} → ${remainingStake*2} → ${remainingStake*4}…`:progression==="increase"?`đi ${remainingStake} → ${remainingStake*2} → ${remainingStake*3}…`:`giữ ${remainingStake} mỗi ngày`}.`:"Nhập 0 để dừng ngay khi cặp đầu tiên về."}</small>
      </div>
    </div>
  </div>
  <div class="table-wrap bridge-fixed-plan"><table>
    <thead><tr><th>Ngày</th><th>Điểm đánh</th><th>Điểm trừ</th><th>Kết quả</th><th>Điểm cộng</th><th>Chênh lệch ngày</th></tr></thead>
    <tbody>
    <tr class="fixed-summary-row"><th colspan="2">Tổng kết đến hiện tại</th><th class="negative">-${fixedPlan.totalCost}</th><th>${fixedPlan.completedPairs.length===fixedPlan.pairs.length?'<span class="double-hit-label">ĐỦ 2 CẶP · ĐÃ DỪNG</span>':fixedPlan.stopped?'<span class="muted">ĐÃ DỪNG SAU CẶP ĐẦU</span>':`Đã về ${fixedPlan.completedPairs.length}/${fixedPlan.pairs.length} cặp`}</th><th class="positive">+${fixedPlan.totalReward}</th><th class="${fixedPlan.net>=0?'positive':'negative'}">${fixedPlan.net>=0?'+':''}${fixedPlan.net}</th></tr>
    ${fixedPlan.rows.map(row=>`<tr class="${row.status==='hit'?'double-hit-row':''}">
      <td><strong>${row.day}</strong><small>${displayDate(row.date)}</small></td>
      <td>${row.status==="stopped"?"-":`${row.activePairs.join(" - ")} · ${row.stakeUsed}đ/cặp`}</td>
      <td>${row.cost?`<span class="negative">-${row.cost}</span>`:"-"}</td>
      <td>${row.status==="hit"?`<strong class="double-hit-label">VỀ ${row.hitPairs.join(" - ")}</strong>${row.completedCount<fixedPlan.pairs.length?`<small>${remainingStake?`Tiếp tục cặp còn lại ${remainingStake} điểm/ngày`:"Đã chọn dừng"}</small>`:''}`:row.status==="miss"?"Chưa về":row.status==="stopped"?'<span class="muted">Đã dừng</span>':'<span class="pending">Chờ KQ</span>'}</td>
      <td>${row.reward?`<span class="positive">+${row.reward}</span>`:"-"}</td>
      <td>${row.status==="miss"||row.status==="hit"?`<strong class="${row.net>=0?'positive':'negative'}">${row.net>=0?'+':''}${row.net}</strong>`:"-"}</td>
    </tr>`).join("")}</tbody>
  </table></div>
  <div class="bridge-period-heading">
    <strong>Thống kê điểm theo kỳ</strong>
    <div class="bridge-period-controls"><label>Hiển thị
        <select onchange="setDoubleBridgeStatsRange(this.value)">
          <option value="month" ${statsRange==="month"?'selected':''}>Theo tháng</option>
          <option value="quarter" ${statsRange==="quarter"?'selected':''}>Theo quý</option>
          <option value="year" ${statsRange==="year"?'selected':''}>Theo năm</option>
        </select>
      </label>
      <label>Chọn kỳ${statsPeriodControl}</label>
    </div>
  </div>
  <div class="table-wrap bridge-period-stats"><table>
    <thead><tr><th>Kỳ thống kê</th><th>Số tuần</th><th>Điểm trừ</th><th>Điểm cộng</th><th>Chênh lệch</th></tr></thead>
    <tbody><tr class="period-total-row">
      <td><strong>${displayDate(statsStart)} – ${displayDate(statsEnd)}</strong></td><td>${periodPlans.length}</td>
      <td class="negative">-${periodTotal.cost}</td><td class="positive">+${periodTotal.reward}</td>
      <td><strong class="${periodTotal.net>=0?'positive':'negative'}">${periodTotal.net>=0?'+':''}${periodTotal.net}</strong></td>
    </tr>
    ${periodPlans.map(item=>`<tr>
      <td><strong>Tuần ${displayDate(addDate(item.source.date,1))}</strong><small>${item.plan.pairs.join(" - ")}</small></td><td>1</td>
      <td class="negative">-${item.plan.totalCost}</td><td class="positive">+${item.plan.totalReward}</td>
      <td><strong class="${item.plan.net>=0?'positive':'negative'}">${item.plan.net>=0?'+':''}${item.plan.net}</strong></td>
    </tr>`).join("")}</tbody>
  </table></div>
  <div class="bridge-backtest-head hidden-bridge-extra">
    <strong>Backtest chiến thuật 3 điểm trên các tuần quá khứ</strong>
    <span>Sau cặp đầu: ${remainingStake?`${remainingStake} điểm gốc · ${progression==="double"?"gấp thếp ×2":progression==="increase"?"tăng đều":"giữ nguyên"}`:"dừng luôn"}</span>
  </div>
  ${historicalFixedPlans.length?`<div class="bridge-history-summary">
    <div><span>Số tuần đủ dữ liệu</span><strong>${historicalFixedPlans.length}</strong></div>
    <div><span>Tuần dương</span><strong class="positive">${historicalTotals.positive} · ${percent(historicalTotals.positive,historicalFixedPlans.length)}</strong></div>
    <div><span>Tuần âm</span><strong class="negative">${historicalTotals.negative} · ${percent(historicalTotals.negative,historicalFixedPlans.length)}</strong></div>
    <div><span>Về ít nhất 1 cặp</span><strong>${historicalTotals.first} · ${percent(historicalTotals.first,historicalFixedPlans.length)}</strong></div>
    <div><span>Về đủ 2 cặp</span><strong>${historicalTotals.both} · ${percent(historicalTotals.both,historicalFixedPlans.length)}</strong></div>
    <div><span>Tổng chênh lệch</span><strong class="${historicalTotals.net>=0?'positive':'negative'}">${historicalTotals.net>=0?'+':''}${historicalTotals.net}</strong></div>
    <div><span>ROI</span><strong class="${historicalTotals.net>=0?'positive':'negative'}">${historicalTotals.cost?`${historicalTotals.net>=0?'+':''}${Math.round(historicalTotals.net/historicalTotals.cost*100)}%`:"-"}</strong></div>
  </div>
  <div class="table-wrap bridge-history-plan"><table>
    <thead><tr><th>Tuần áp dụng</th><th>Hai cặp kép</th><th>Đã về</th><th>Điểm trừ</th><th>Điểm cộng</th><th>Chênh lệch</th></tr></thead>
    <tbody>${historicalFixedPlans.map(item=>`<tr class="${item.plan.net>=0?'history-positive':'history-negative'}">
      <td><strong>${displayDate(item.start)} – ${displayDate(item.end)}</strong><small>Chốt từ ${displayDate(item.source.date)}</small></td>
      <td>${item.plan.pairs.join(" - ")}</td>
      <td>${item.plan.completedPairs.length}/${item.plan.pairs.length}${item.plan.completedPairs.length?` · ${item.plan.completedPairs.join(" - ")}`:""}</td>
      <td class="negative">-${item.plan.totalCost}</td><td class="positive">+${item.plan.totalReward}</td>
      <td><strong class="${item.plan.net>=0?'positive':'negative'}">${item.plan.net>=0?'+':''}${item.plan.net}</strong></td>
    </tr>`).join("")}</tbody>
  </table></div>`:'<p class="muted hidden-bridge-extra">Chưa có tuần quá khứ nào đủ cả 8 ngày kết quả để backtest.</p>'}
  <div class="bridge-backtest-head hidden-bridge-extra">
    <strong>Phân bổ điểm dự đoán không âm khi 1 cặp về</strong>
    <span>Hai cặp đánh cùng điểm · dừng ngay sau khi đã về</span>
  </div>
  <div class="table-wrap bridge-allocation"><table>
    <thead><tr><th>Ngày</th><th>Tỷ lệ quá khứ</th><th>Điểm mỗi cặp</th><th>Điểm trừ ngày</th><th>Tổng điểm trừ</th><th>Nếu 1 cặp về</th><th>Chênh lệch lũy kế</th></tr></thead>
    <tbody>${breakEvenPlan.map(row=>`<tr>
      <td><strong>${row.day}</strong></td>
      <td>${percent(row.any,row.samples)} <small>(${row.any}/${row.samples})</small></td>
      <td><strong>${row.stake}đ / cặp</strong></td>
      <td class="negative">-${row.dayCost}</td><td>-${row.cumulativeCost}</td>
      <td class="positive">+${row.oneHitReward}</td>
      <td><strong class="${row.oneHitNet>=0?'positive':'negative'}">${row.oneHitNet>=0?'+':''}${row.oneHitNet}</strong></td>
    </tr>`).join("")}</tbody>
  </table></div>
  <p class="bridge-risk-note"><strong>Lưu ý:</strong> Bảng chỉ cân điểm để không âm nếu ít nhất một cặp kép xuất hiện và dừng đúng lúc. Điểm tăng rất nhanh qua từng ngày; không có quy luật nào bảo đảm kết quả sẽ về.</p>
  <div class="bridge-backtest-head hidden-bridge-extra">
    <strong>So sánh dữ liệu các tuần quá khứ</strong>
    ${bestDay?`<span>Ngày có tỷ lệ về ít nhất 1 cặp cao nhất: <b>${bestDay.day} · ${percent(bestDay.any,bestDay.samples)}</b></span>`:""}
  </div>
  <div class="table-wrap bridge-backtest"><table>
    <thead><tr><th>Ngày trong tuần</th><th>Số tuần có dữ liệu</th><th>Về ít nhất 1 cặp</th><th>Về cả 2 cặp</th><th>Cặp kép từ số đầu</th><th>Cặp kép từ số sau</th></tr></thead>
    <tbody>${backtest.map(row=>`<tr class="${bestDay===row?'best-double-day':''}">
      <td><strong>${row.day}</strong></td><td>${row.samples}</td>
      <td><b>${percent(row.any,row.samples)}</b> <small>(${row.any}/${row.samples})</small></td>
      <td>${percent(row.both,row.samples)} <small>(${row.both}/${row.samples})</small></td>
      <td>${percent(row.first,row.samples)} <small>(${row.first}/${row.samples})</small></td>
      <td>${percent(row.second,row.samples)} <small>(${row.second}/${row.samples})</small></td>
    </tr>`).join("")}</tbody>
  </table></div>`;
}

function renderEntries(){
  const filter=$("#filterDate").value;
  const entries=visibleEntries([...state.entries]).filter(x=>!filter||x.date===filter).sort((a,b)=>b.date.localeCompare(a.date));
  if(!entries.length){
    $("#summaryBody").innerHTML=`<tr><td colspan="9" class="muted">${canUsePlayerData()?"Chưa có lượt nào.":"Đăng nhập người chơi để xem dữ liệu của bạn."}</td></tr>`;
    return;
  }
  const grouped=new Map();
  entries.forEach(entry=>{
    if(!grouped.has(entry.date)) grouped.set(entry.date,[]);
    grouped.get(entry.date).push(entry);
  });
  $("#summaryBody").innerHTML=[...grouped.entries()].map(([date,dayEntries])=>{
    let totalPoints=0,loHits=0,deHits=0,cost=0,reward=0,pending=0;
    dayEntries.forEach(entry=>{
      const c=calc(entry);
      totalPoints+=entry.points;
      cost+=c.cost;
      if(c.reward===null) pending++;
      else {
        reward+=c.reward;
        if(entry.type==="lo") loHits+=c.hits;
        else deHits+=c.hits;
      }
    });
    const net=reward-cost;
    const detailId=`detail-${date.replace(/\D/g,"")}`;
    return `
      <tr class="summary-row" onclick="toggleDayDetail('${detailId}')">
        <td><strong>${displayDate(date)}</strong>${pending?`<br><small class="pending">${pending} lượt chờ</small>`:""}</td>
        <td>${dayEntries.length}</td>
        <td>${totalPoints}</td>
        <td>${loHits}</td>
        <td>${deHits}</td>
        <td>${cost}</td>
        <td>${reward}</td>
        <td><span class="${net>=0?'positive':'negative'}">${net>=0?'+':''}${net}</span></td>
        <td><button class="danger" type="button" onclick="event.stopPropagation();removeEntriesByDate('${date}')">Xóa</button></td>
      </tr>
      <tr id="${detailId}" class="detail-row">
        <td colspan="9">${renderEntryDetails(dayEntries)}</td>
      </tr>`;
  }).join("");
}

function renderEntryDetails(entries){
  const rows=buildEntryDetailRows(entries);
  return `<div class="detail-list">
    <table class="detail-table">
      <thead><tr><th>Thành viên</th><th>Loại</th><th>Số</th><th>Điểm ghi</th><th>Số lần trúng</th><th>Điểm trừ</th><th>Điểm cộng</th><th>Chênh lệch</th><th></th></tr></thead>
      <tbody>${rows.map(row=>{
        if(row.kind==="group")return renderGroupedEntryDetail(row.entries);
        const e=row.entries[0];
        const c=calc(e);
        const status=c.net===null?'<span class="pending">Chờ kết quả</span>':
          `<span class="${c.net>=0?'positive':'negative'}">${c.net>=0?'+':''}${c.net}</span>`;
        return `<tr>
          <td>${esc(memberName(e.memberId))}</td>
          <td>${e.type==="lo"?"Lô":"Đề"}</td>
          <td><strong>${e.number}</strong></td>
          <td>${e.points}</td>
        <td>${hitLabel(e,c)}</td>
          <td>${c.cost}</td>
        <td>${c.reward===null?"-":c.reward}</td>
          <td>${status}</td>
          <td>${canModifyEntry(e)?`<button class="danger" onclick="event.stopPropagation();removeEntry('${e.id}')">Xóa</button>`:""}</td>
        </tr>`;
      }).join("")}</tbody>
    </table>
  </div>`;
}

function buildEntryDetailRows(entries){
  const grouped=new Map();
  entries.forEach(entry=>{
    const key=`${entry.memberId}|${entry.type}|${entry.points}`;
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push(entry);
  });
  return [...grouped.values()]
    .sort((a,b)=>(a[0].type==="lo"?0:1)-(b[0].type==="lo"?0:1)||b[0].points-a[0].points)
    .map(group=>({kind:group.length>1?"group":"single",entries:group}));
}

function renderGroupedEntryDetail(entries){
  const first=entries[0];
  let cost=0,reward=0,net=0,pending=0,hits=0;
  const matches=[];
  entries.forEach(entry=>{
    const c=calc(entry);
    cost+=c.cost;
    if(c.reward===null) pending++;
    else {
      reward+=c.reward;
      net+=c.net;
      hits+=c.hits;
      matches.push(...c.matches.map(x=>`${entry.number}:${x}`));
    }
  });
  const status=pending?'<span class="pending">Chờ kết quả</span>':
    `<span class="${net>=0?'positive':'negative'}">${net>=0?'+':''}${net}</span>`;
  const highlightedMatches=entries.filter(entry=>calc(entry).hits>0)
    .map(entry=>`<span class="hit-number">${esc(entry.number)}</span>`).join(", ");
  const hitText=pending?"-":first.type==="de"?
    `${hits} con trúng${matches.length?` (${matches.map(esc).join(", ")})`:""}`:
    `${hits} lần${highlightedMatches?` · ${highlightedMatches}`:""}${matches.length?` (${matches.map(esc).join(", ")})`:""}`;
  const ids=entries.map(e=>e.id).join(",");
  const numbers=groupNumbersLabel(entries);
  return `<tr>
    <td>${esc(memberName(first.memberId))}</td>
    <td>${first.type==="lo"?"Lô":"Đề"}</td>
    <td><strong>${esc(numbers)}</strong></td>
    <td>${first.points} / số</td>
    <td>${hitText}</td>
    <td>${cost}</td>
    <td>${pending?"-":reward}</td>
    <td>${status}</td>
    <td>${entries.every(canModifyEntry)?`<button class="danger" onclick="event.stopPropagation();removeEntries('${ids}')">Xóa</button>`:""}</td>
  </tr>`;
}

function groupNumbersLabel(entries){
  const numbers=[...new Set(entries.map(e=>e.number))].sort();
  const heads=[...new Set(numbers.map(n=>n[0]))];
  const labels=heads.map(head=>{
    const full=Array.from({length:10},(_,tail)=>`${head}${tail}`);
    return full.every(n=>numbers.includes(n))?`${head}0 -> ${head}9`:full.filter(n=>numbers.includes(n)).join("-");
  });
  return labels.join(", ");
}

function toggleDayDetail(id){
  const row=document.getElementById(id);
  if(row) row.classList.toggle("open");
}
window.toggleDayDetail=toggleDayDetail;

function renderResultPreview(tempImage,preserveSelection=false){
  const sorted=stateCache.resultsDesc;
  const selectedDate=$("#resultSelect").value;
  $("#resultSelect").innerHTML=sorted.length?sorted.map(r=>`<option value="${r.date}">${displayDate(r.date)}</option>`).join(""):'<option>Chưa có kết quả</option>';
  if(preserveSelection&&sorted.some(r=>r.date===selectedDate)) $("#resultSelect").value=selectedDate;
  else if(sorted[0]) $("#resultSelect").value=sorted[0].date;
  const chosen=selectedResult();
  if(chosen) $("#resultSelect").value=chosen.date;
  $("#resultPreview").innerHTML=chosen?`
    <p><strong>${displayDate(chosen.date)}</strong> · ${chosen.prizes.length} giải đã nhập</p>
    ${renderPrizeTable(chosen)}
    <p class="saved-loto"><strong>Lô tô đã lưu:</strong> ${lotoNumbers(chosen).map(n=>`<span>${n}</span>`).join("")}</p>`:
    '<p class="muted">Chưa có kết quả.</p>';
}

function renderPrizeTable(result){
  const groups=[
    ["Đặc biệt",0,1,1],
    ["Giải nhất",1,2,1],
    ["Giải nhì",2,4,2],
    ["Giải ba",4,10,3],
    ["Giải tư",10,14,4],
    ["Giải năm",14,20,3],
    ["Giải sáu",20,23,3],
    ["Giải bảy",23,27,4]
  ];
  return `<table class="prize-table"><tbody>${groups.map(([label,start,end,cols])=>{
    const numbers=result.prizes.slice(start,end);
    if(!numbers.length)return "";
    const rows=[];
    for(let i=0;i<numbers.length;i+=cols) rows.push(numbers.slice(i,i+cols));
    return rows.map((row,index)=>`
      <tr class="${start===0?"special-row":""}">
        ${index===0?`<th rowspan="${rows.length}">${label}</th>`:""}
        <td colspan="${Math.max(1,12/cols)}">${row.map(n=>`<span class="prize-number">${esc(n)}</span>`).join("")}</td>
      </tr>`).join("");
  }).join("")}</tbody></table>`;
}

function showResultModal(date){
  const result=resultForDate(date);
  if(!result)return;
  $("#resultModalTitle").textContent=`Kết quả ${displayDate(result.date)}`;
  $("#resultModalBody").innerHTML=`
    <div class="result-shot">
      <h3>Xổ số miền Bắc</h3>
      <p>${displayDate(result.date)} · ĐB ${esc(result.special)} · ${result.prizes.length} giải</p>
      <div class="result-shot-grid">
        <div>${renderPrizeTable(result)}</div>
        <div>${renderModalHeadTable(result)}</div>
      </div>
    </div>`;
  $("#resultModal").classList.remove("hidden");
}

function closeResultModal(){
  $("#resultModal").classList.add("hidden");
  $("#resultModalBody").innerHTML="";
}
window.showResultModal=showResultModal;
window.closeResultModal=closeResultModal;

function renderModalHeadTable(result){
  const special=two(result.special);
  const byHead=Array.from({length:10},()=>[]);
  lotoNumbers(result).forEach(number=>byHead[Number(number[0])].push(number));
  return `<table class="loto-table modal-loto-table">
    <thead><tr><th colspan="2">Đầu lô</th></tr></thead>
    <tbody>${byHead.map((numbers,index)=>`
      <tr>
        <th>${index}</th>
        <td>${numbers.map(n=>`<span class="${n===special?'special-loto':''}">${n}</span>`).join("; ")}${numbers.length?";":""}</td>
      </tr>`).join("")}</tbody>
  </table>`;
}

function renderHeadStats(){
  const result=selectedResult();
  if(!result){
    $("#headStats").innerHTML='<p class="muted">Chưa có kết quả để thống kê.</p>';
    return;
  }
  const special=two(result.special);
  const nums=lotoNumbers(result);
  const byHead=Array.from({length:10},()=>[]);
  const byTail=Array.from({length:10},()=>[]);
  nums.forEach(number=>{
    byHead[Number(number[0])].push(number);
    byTail[Number(number[1])].push(number);
  });
  const renderRows=groups=>groups.map((numbers,index)=>`
    <tr>
      <th>${index}</th>
      <td>${numbers.map(n=>`<span class="${n===special?'special-loto':''}">${n}</span>`).join("; ")}${numbers.length?";":""}</td>
    </tr>`).join("");
  $("#headStats").innerHTML=`
    <div class="loto-stats">
      <table class="loto-table"><thead><tr><th colspan="2">Đầu Lô tô</th></tr></thead><tbody>${renderRows(byHead)}</tbody></table>
      <table class="loto-table"><thead><tr><th colspan="2">Đuôi Lô tô</th></tr></thead><tbody>${renderRows(byTail)}</tbody></table>
    </div>`;
}

function renderResultStats(){
  const entries=visibleEntries(state.entries);
  const all=aggregate(entries);
  const allDates=stateCache.resultsDesc.map(r=>r.date);
  const dates=filterResultStatDates(allDates);
  const rangeLabel=resultStatsRangeLabel($("#resultStatsRange").value,dates.length,allDates.length);
  const todayResult=resultForDate(today());
  $("#resultStats").innerHTML=`
    <div class="stat-grid">
      <div class="stat-card">Ngày có kết quả<strong>${state.results.length}</strong></div>
      <div class="stat-card">Lượt đã nhập<strong>${entries.length}</strong></div>
      <div class="stat-card">Lượt chờ chấm<strong>${all.pending}</strong></div>
      <div class="stat-card ${todayResult?'result-hit':''}">KQ hôm nay ${displayDate(today())}<strong>${todayResult?`ĐB ${esc(todayResult.special)}`:"Chưa có"}</strong><small>${todayResult?`${todayResult.prizes.length} giải đã lưu`:"Ngày này chưa nằm trong dữ liệu máy"}</small></div>
    </div>
    <p class="muted result-range-note">${rangeLabel}</p>
    ${todayResult?"":`<p class="muted result-range-note">Nếu Cầu đặc biệt hiện ${displayDate(today())}, đó có thể là ngày dự đoán tiếp theo. Muốn chấm kết quả hôm nay thì cần nhập hoặc cập nhật CSV có ngày ${displayDate(today())}.</p>`}
    <div class="result-list">
      ${dates.length?dates.map(date=>{
        const r=resultForDate(date);
        const dayEntries=entries.filter(e=>e.date===date);
        const a=aggregate(dayEntries);
        const hasHit=a.hits>0;
        return `<div class="result-item ${hasHit?'result-hit':''}">
          <div><strong>${displayDate(date)}</strong><br><small>ĐB ${esc(r.special)} · ${r.prizes.length} giải · ${dayEntries.length} lượt</small>${hasHit?'<br><small class="hit-note">Dự đoán đúng</small>':""}</div>
          <span class="pill ${hasHit?'hit-pill':''}">${hasHit?`Dự đoán đúng ${a.hits} lần`:`${a.hits} lần trúng`}</span>
        </div>`;
      }).join(""):'<p class="muted">Chưa có kết quả đã lưu.</p>'}
    </div>`;
}

function filterResultStatDates(dates){
  const range=$("#resultStatsRange")?.value||"7";
  const includeToday=filtered=>{
    const day=today();
    return stateCache.resultsByDate.has(day)&&!filtered.includes(day)?[day,...filtered]:filtered;
  };
  if(range==="7")return includeToday(dates.slice(0,7));
  if(range==="all")return dates;
  const base=dates[0]||today();
  let start="";
  if(range==="week")start=dateAdd(base,-6);
  else if(range==="month")start=`${base.slice(0,7)}-01`;
  else if(range==="quarter"){
    const year=Number(base.slice(0,4));
    const month=Number(base.slice(5,7));
    const qStart=String(Math.floor((month-1)/3)*3+1).padStart(2,"0");
    start=`${year}-${qStart}-01`;
  }else if(range==="year")start=`${base.slice(0,4)}-01-01`;
  return includeToday(start?dates.filter(date=>date>=start&&date<=base):dates.slice(0,7));
}

function resultStatsRangeLabel(range,count,total){
  const labels={7:"7 ngày gần nhất",week:"tuần gần nhất",month:"tháng này",quarter:"quý này",year:"năm này",all:"tất cả"};
  return `Đang hiển thị ${count}/${total} ngày: ${labels[range]||labels["7"]}.`;
}

function dateAdd(date,days){
  const d=new Date(`${date}T00:00:00`);
  d.setDate(d.getDate()+days);
  return localDate(d);
}

function daysBetween(from,to){
  const a=new Date(`${from}T00:00:00`);
  const b=new Date(`${to}T00:00:00`);
  return Math.round((b-a)/86400000);
}

function renderSpecialStats(){
  renderSpecialYearOptions();
  const year=$("#specialYear").value||String(new Date().getFullYear());
  const start=`${year}-01-01`;
  const end=`${year}-12-31`;
  const results=stateCache.results
    .filter(r=>r.date>=start&&r.date<=end&&r.special)
  ;
  const counts=Array.from({length:100},(_,i)=>({number:String(i).padStart(2,"0"),count:0,lastDate:""}));
  results.forEach(r=>{
    lotoNumbers(r).forEach(n=>{
      const row=counts[Number(n)];
      row.count++;
      row.lastDate=r.date;
    });
  });
  const hot=[...counts].filter(x=>x.count).sort((a,b)=>b.count-a.count||a.number.localeCompare(b.number)).slice(0,20);
  const overdue=[...counts].map(x=>({
    ...x,
    gap:x.lastDate?daysBetween(x.lastDate,end):Number.POSITIVE_INFINITY
  })).sort((a,b)=>b.gap-a.gap||a.number.localeCompare(b.number)).slice(0,20);
  const latest=results.at(-1);
  $("#specialStats").innerHTML=`
    ${renderSpecialYearTable(year)}
    <div class="stat-grid">
      <div class="stat-card">Khoảng ngày<strong>${displayDate(start)} - ${displayDate(end)}</strong></div>
      <div class="stat-card">Ngày có dữ liệu<strong>${results.length}</strong><small>${latest?`Mới nhất ${displayDate(latest.date)}: ${two(latest.special)}`:"Chưa có kết quả trong kỳ"}</small></div>
      <div class="stat-card">Số lô khác nhau<strong>${counts.filter(x=>x.count).length}</strong><small>Thống kê toàn bộ lô tô 2 số</small></div>
    </div>
    <div class="special-stat-grid">
      <div>
        <h3>Tần suất lô tô</h3>
        ${renderSpecialStatTable(hot,false)}
      </div>
      <div>
        <h3>Lô lâu xuất hiện</h3>
        ${renderSpecialStatTable(overdue,true)}
      </div>
    </div>`;
}

function renderSpecialYearOptions(){
  const select=$("#specialYear");
  const current=select.value;
  const years=[...stateCache.resultYears];
  const thisYear=String(new Date().getFullYear());
  if(!years.includes(thisYear))years.unshift(thisYear);
  select.innerHTML=years.map(y=>`<option value="${y}">${y}</option>`).join("");
  select.value=years.includes(current)?current:years[0];
}

function renderSpecialYearTable(year){
  const byDate=stateCache.resultsByDate;
  const rows=Array.from({length:31},(_,i)=>i+1).map(day=>{
    const cells=Array.from({length:12},(_,monthIndex)=>{
      const month=String(monthIndex+1).padStart(2,"0");
      const date=`${year}-${month}-${String(day).padStart(2,"0")}`;
      const d=new Date(`${date}T00:00:00`);
      const valid=d.getFullYear()===Number(year)&&d.getMonth()===monthIndex&&d.getDate()===day;
      const result=byDate.get(date);
      if(!valid)return '<td class="empty-month"></td>';
      return `<td class="${result?'has-special':''}">${result?formatSpecialCell(result.special,date):""}</td>`;
    }).join("");
    return `<tr><th>${day}</th>${cells}</tr>`;
  }).join("");
  return `<div class="special-year-table-wrap">
    <div class="special-year-title">Bảng đặc biệt Xổ Số năm ${year}</div>
    <table class="special-year-table">
      <thead><tr><th>Ngày</th>${Array.from({length:12},(_,i)=>`<th>Th${i+1}</th>`).join("")}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function formatSpecialCell(value,date){
  const special=String(value||"").padStart(5,"0");
  return `<button class="special-cell-btn" type="button" onclick="showResultModal('${date}')">
    <span>${esc(special.slice(0,-2))}</span><strong>${esc(special.slice(-2))}</strong>
  </button>`;
}

function renderSpecialStatTable(rows,showGap){
  if(!rows.length)return '<p class="muted">Chưa có dữ liệu.</p>';
  return `<table class="special-table"><thead><tr><th>Số</th><th>Tần suất</th><th>Lần gần nhất</th>${showGap?'<th>Số ngày</th>':""}</tr></thead>
    <tbody>${rows.map(row=>`<tr>
      <td><strong>${row.number}</strong></td>
      <td>${row.count}</td>
      <td>${row.lastDate?displayDate(row.lastDate):"Chưa xuất hiện"}</td>
      ${showGap?`<td>${Number.isFinite(row.gap)?row.gap:"Chưa có"}</td>`:""}
    </tr>`).join("")}</tbody></table>`;
}

function syncDbBridgeBaseDate(){
  const input=$("#dbBridgeBaseDate");
  const tracker=patternBaseState.dbbridge;
  const latest=stateCache.resultsDesc.find(r=>r?.special)?.date||"";
  if(!input)return "";
  if(latest&&tracker.latest!==latest){
    tracker.latest=latest;
    tracker.manual=false;
  }
  if(latest&&(!tracker.manual||!input.value||!stateCache.resultsByDate.has(input.value))){
    input.value=latest;
  }
  return input.value;
}

function renderDbBridgeStats(){
  syncDbBridgeBaseDate();
  const analysis=buildDbBridgeAnalysis($("#dbBridgeBaseDate").value);
  const target=$("#dbBridgeStats");
  if(!analysis.baseResult){
    target.innerHTML='<p class="muted">Chưa có dữ liệu giải đặc biệt để soi cầu.</p>';
    return;
  }
  const hitRate=analysis.rows.length?Math.round(analysis.hitDays/analysis.rows.length*100):0;
  const copyText=analysis.prediction.map(row=>`lô ${row.number}`).join(" ");
  const forecastResult=resultForDate(analysis.forecastDate);
  target.innerHTML=`
    <div class="stat-grid db-bridge-summary">
      <div class="stat-card">Khoảng soi<strong>${displayDate(analysis.start)} - ${displayDate(analysis.end)}</strong><small>3 tháng gần nhất theo ngày soi</small></div>
      <div class="stat-card">Ngày soi<strong>${displayDate(analysis.baseDate)}</strong><small>ĐB ${esc(analysis.baseResult.special)}</small></div>
      <div class="stat-card">Ngày dự đoán tiếp<strong>${displayDate(analysis.forecastDate)}</strong><small>${forecastResult?`Đã có KQ ĐB ${esc(forecastResult.special)}`:"Chưa có KQ đã lưu"} · ${analysis.rows.length} mẫu đã chấm</small></div>
      <div class="stat-card">Ngày có cầu ăn lô<strong>${analysis.hitDays}/${analysis.rows.length}</strong><small>${hitRate}% có ít nhất 1 cặp khớp</small></div>
    </div>
    <div class="reference-group db-bridge-picks">
      <strong>Cầu Đặc biệt tham khảo cho ${displayDate(analysis.forecastDate)}</strong>
      <div class="reference-numbers">${analysis.prediction.map(row=>`<span>${row.number}<small>${Math.round(row.rate*100)}%</small></span>`).join("")}</div>
      ${copyText?`<small>${esc(copyText)}</small><button class="secondary" type="button" data-text="${esc(copyText)}" onclick="copyReferenceText(this.dataset.text)">Copy dãy lô</button>`:""}
    </div>
    <div class="pattern-grid db-bridge-grid">
      <div>
        <h3>Tỷ lệ từng cầu</h3>
        ${renderDbBridgeRuleTable(analysis.allRules)}
      </div>
      <div>
        <h3>Lịch sử khớp gần nhất</h3>
        ${renderDbBridgeHistoryTable(analysis.rows.slice(0,30))}
      </div>
    </div>`;
}

function renderDbBridgeRuleTable(rows){
  if(!rows.length)return '<p class="muted">Chưa đủ dữ liệu để chấm cầu.</p>';
  return `<table class="special-table db-bridge-table"><thead><tr><th>Cầu</th><th>Số hôm nay</th><th>Trúng lô hôm sau</th><th>Gần nhất</th></tr></thead>
    <tbody>${rows.map(row=>`
      <tr>
        <td>${esc(row.label)}</td>
        <td><strong>${row.number}</strong></td>
        <td>${row.hit}/${row.total} · ${Math.round(row.rate*100)}%</td>
        <td>${row.lastHitDate?displayDate(row.lastHitDate):"-"}</td>
      </tr>`).join("")}</tbody></table>`;
}

function renderDbBridgeHistoryTable(rows){
  if(!rows.length)return '<p class="muted">Chưa có cặp ngày liền kề trong khoảng soi.</p>';
  return `<table class="special-table db-bridge-table"><thead><tr><th>ĐB gốc</th><th>Ngày hôm sau</th><th>Cặp khớp lô</th></tr></thead>
    <tbody>${rows.map(row=>`
      <tr class="${row.hitRules.length?'history-positive':'history-negative'}">
        <td>${displayDate(row.baseDate)}<br><strong>${esc(row.baseSpecial)}</strong></td>
        <td>${displayDate(row.nextDate)}<br><small>ĐB ${esc(row.nextSpecial)}</small></td>
        <td>${row.hitRules.length?row.hitRules.map(rule=>`<span class="hit-number">${rule.number}</span> <small>${esc(rule.label)}</small>`).join("<br>"):"-"}</td>
      </tr>`).join("")}</tbody></table>`;
}

function renderPatternYearOptions(){
  const select=$("#patternYear");
  const current=select.value;
  const years=[...stateCache.resultYears];
  const thisYear=String(new Date().getFullYear());
  if(!years.includes(thisYear))years.unshift(thisYear);
  select.innerHTML=`<option value="all">Tất cả</option>`+years.map(y=>`<option value="${y}">${y}</option>`).join("");
  select.value=current==="all"||years.includes(current)?current:"all";
}

function renderLawYearOptions(){
  const select=$("#lawYear");
  const current=select.value;
  const years=[...stateCache.resultYears];
  const thisYear=String(new Date().getFullYear());
  if(!years.includes(thisYear))years.unshift(thisYear);
  select.innerHTML=`<option value="all">Tất cả</option>`+years.map(y=>`<option value="${y}">${y}</option>`).join("");
  select.value=current==="all"||years.includes(current)?current:"all";
}

function syncPatternBaseDate(kind,inputSelector,yearSelector){
  const tracker=patternBaseState[kind];
  const input=$(inputSelector);
  const yearSelect=$(yearSelector);
  const latest=stateCache.resultsDesc[0]?.date||"";
  if(!input)return "";
  if(latest&&tracker.latest!==latest){
    tracker.latest=latest;
    tracker.manual=false;
  }
  if(latest&&(!tracker.manual||!input.value||!stateCache.resultsByDate.has(input.value))){
    input.value=latest;
  }
  if(latest&&yearSelect&&yearSelect.value!=="all"&&!latest.startsWith(`${yearSelect.value}-`)){
    yearSelect.value=latest.slice(0,4);
  }
  return input.value;
}

function addDate(date,days){
  const d=new Date(`${date}T00:00:00`);
  d.setDate(d.getDate()+days);
  return localDate(d);
}

function reverse2(number){
  return String(number).padStart(2,"0").split("").reverse().join("");
}

function dbBridgeRules(result){
  const special=String(result?.special||"").replace(/\D/g,"").padStart(5,"0").slice(-5);
  if(!special||special.length<5)return [];
  const digits=special.split("");
  return [
    {key:"first2",label:"2 số đầu ĐB",number:`${digits[0]}${digits[1]}`},
    {key:"first2-reverse",label:"Đảo 2 số đầu ĐB",number:`${digits[1]}${digits[0]}`},
    {key:"last2",label:"2 số cuối ĐB",number:`${digits[3]}${digits[4]}`},
    {key:"last2-reverse",label:"Đảo 2 số cuối ĐB",number:`${digits[4]}${digits[3]}`},
    {key:"first-last",label:"Ghép đầu + cuối ĐB",number:`${digits[0]}${digits[4]}`},
    {key:"last-first",label:"Ghép lộn đầu + cuối ĐB",number:`${digits[4]}${digits[0]}`}
  ].map(rule=>({...rule,number:two(rule.number)}));
}

function buildDbBridgeAnalysis(baseDateValue){
  const latest=stateCache.resultsDesc.find(r=>r?.special)?.date||"";
  const baseDate=baseDateValue&&stateCache.resultsByDate.has(baseDateValue)?baseDateValue:latest;
  const baseResult=baseDate?stateCache.resultsByDate.get(baseDate):null;
  const start=baseDate?addDate(baseDate,-92):"";
  const end=baseDate||latest;
  const results=stateCache.results.filter(r=>r.special&&r.date>=start&&r.date<=end);
  const byDate=stateCache.resultsByDate;
  const ruleStats=new Map();
  const rows=[];
  results.forEach(result=>{
    const nextDate=addDate(result.date,1);
    const next=byDate.get(nextDate);
    if(!next)return;
    const nextLoto=new Set(lotoNumbers(next));
    const checked=dbBridgeRules(result).map(rule=>{
      const stat=ruleStats.get(rule.key)||{...rule,total:0,hit:0,lastHitDate:"",examples:[]};
      const isHit=nextLoto.has(rule.number);
      stat.total++;
      if(isHit){
        stat.hit++;
        stat.lastHitDate=result.date;
        stat.examples.push({baseDate:result.date,nextDate,nextSpecial:next.special,number:rule.number});
      }
      ruleStats.set(rule.key,stat);
      return {...rule,hit:isHit};
    });
    const hitRules=checked.filter(rule=>rule.hit);
    rows.push({baseDate:result.date,nextDate,nextSpecial:next.special,baseSpecial:result.special,checked,hitRules});
  });
  const currentRules=baseResult?dbBridgeRules(baseResult):[];
  const currentByKey=new Map(currentRules.map(rule=>[rule.key,rule]));
  const prediction=currentRules.map(rule=>{
    const stat=ruleStats.get(rule.key)||{...rule,total:0,hit:0,lastHitDate:"",examples:[]};
    const rate=stat.total?stat.hit/stat.total:0;
    return {...stat,...rule,rate,total:stat.total,hit:stat.hit,lastHitDate:stat.lastHitDate,examples:stat.examples};
  }).sort((a,b)=>b.rate-a.rate||b.hit-a.hit||String(b.lastHitDate).localeCompare(String(a.lastHitDate))||a.number.localeCompare(b.number));
  const allRules=[...ruleStats.values()].map(rule=>({
    ...rule,
    ...(currentByKey.get(rule.key)||{}),
    rate:rule.total?rule.hit/rule.total:0,
    total:rule.total,
    hit:rule.hit,
    lastHitDate:rule.lastHitDate
  }))
    .sort((a,b)=>b.rate-a.rate||b.hit-a.hit||a.label.localeCompare(b.label));
  return {
    baseDate,
    baseResult,
    forecastDate:baseDate?addDate(baseDate,1):"",
    start,
    end,
    rows:rows.sort((a,b)=>b.baseDate.localeCompare(a.baseDate)),
    hitDays:rows.filter(row=>row.hitRules.length).length,
    prediction,
    allRules
  };
}

function sumDigits2(number){
  const s=String(number).padStart(2,"0").split("").reduce((sum,n)=>sum+Number(n),0);
  return String(s%10).padStart(2,"0");
}

function complement100(number){
  const n=Number(two(number));
  return String((100-n)%100).padStart(2,"0");
}

function solarSignals(date){
  const [y,m,d]=date.split("-").map(Number);
  return [
    String(d).padStart(2,"0"),
    String(m).padStart(2,"0"),
    `${String(d).slice(-1)}${String(m).slice(-1)}`,
    `${String(m).slice(-1)}${String(d).slice(-1)}`
  ];
}

function jdFromDate(dd,mm,yy){
  const a=Math.floor((14-mm)/12);
  const y=yy+4800-a;
  const m=mm+12*a-3;
  let jd=dd+Math.floor((153*m+2)/5)+365*y+Math.floor(y/4)-Math.floor(y/100)+Math.floor(y/400)-32045;
  if(jd<2299161)jd=dd+Math.floor((153*m+2)/5)+365*y+Math.floor(y/4)-32083;
  return jd;
}
function jdToDate(jd){
  let a,b,c;
  if(jd>2299160){
    a=jd+32044;
    b=Math.floor((4*a+3)/146097);
    c=a-Math.floor((b*146097)/4);
  }else{
    b=0;
    c=jd+32082;
  }
  const d=Math.floor((4*c+3)/1461);
  const e=c-Math.floor((1461*d)/4);
  const m=Math.floor((5*e+2)/153);
  const day=e-Math.floor((153*m+2)/5)+1;
  const month=m+3-12*Math.floor(m/10);
  const year=b*100+d-4800+Math.floor(m/10);
  return [day,month,year];
}
function newMoon(k){
  const t=k/1236.85,t2=t*t,t3=t2*t;
  const dr=Math.PI/180;
  let jd=2415020.75933+29.53058868*k+0.0001178*t2-0.000000155*t3+0.00033*Math.sin((166.56+132.87*t-0.009173*t2)*dr);
  const m=359.2242+29.10535608*k-0.0000333*t2-0.00000347*t3;
  const mpr=306.0253+385.81691806*k+0.0107306*t2+0.00001236*t3;
  const f=21.2964+390.67050646*k-0.0016528*t2-0.00000239*t3;
  let c1=(0.1734-0.000393*t)*Math.sin(m*dr)+0.0021*Math.sin(2*dr*m)-0.4068*Math.sin(mpr*dr)+0.0161*Math.sin(2*dr*mpr)-0.0004*Math.sin(3*dr*mpr)+0.0104*Math.sin(2*dr*f)-0.0051*Math.sin((m+mpr)*dr)-0.0074*Math.sin((m-mpr)*dr)+0.0004*Math.sin((2*f+m)*dr)-0.0004*Math.sin((2*f-m)*dr)-0.0006*Math.sin((2*f+mpr)*dr)+0.0010*Math.sin((2*f-mpr)*dr)+0.0005*Math.sin((2*mpr+m)*dr);
  const delta=t<-11?0.001+0.000839*t+0.0002261*t2-0.00000845*t3-0.000000081*t*t3:-0.000278+0.000265*t+0.000262*t2;
  return Math.floor(jd+c1-delta+0.5+7/24);
}
function sunLongitude(jdn){
  const t=(jdn-2451545.5-7/24)/36525,t2=t*t;
  const dr=Math.PI/180;
  const m=357.52910+35999.05030*t-0.0001559*t2-0.00000048*t*t2;
  const l0=280.46645+36000.76983*t+0.0003032*t2;
  let dl=(1.914600-0.004817*t-0.000014*t2)*Math.sin(dr*m)+(0.019993-0.000101*t)*Math.sin(2*dr*m)+0.000290*Math.sin(3*dr*m);
  let l=(l0+dl)*dr;
  l=l-Math.PI*2*Math.floor(l/(Math.PI*2));
  return Math.floor(l/Math.PI*6);
}
function lunarMonth11(yy){
  const off=jdFromDate(31,12,yy)-2415021;
  const k=Math.floor(off/29.530588853);
  let nm=newMoon(k);
  if(sunLongitude(nm)>=9)nm=newMoon(k-1);
  return nm;
}
function leapMonthOffset(a11){
  const k=Math.floor((a11-2415021.076998695)/29.530588853+0.5);
  let last=0,i=1,arc=sunLongitude(newMoon(k+i));
  do{last=arc;i++;arc=sunLongitude(newMoon(k+i));}while(arc!==last&&i<14);
  return i-1;
}
function solarToLunar(date){
  const [yy,mm,dd]=date.split("-").map(Number);
  const dayNumber=jdFromDate(dd,mm,yy);
  const k=Math.floor((dayNumber-2415021.076998695)/29.530588853);
  let monthStart=newMoon(k+1);
  if(monthStart>dayNumber)monthStart=newMoon(k);
  let a11=lunarMonth11(yy),b11=a11,lunarYear;
  if(a11>=monthStart){lunarYear=yy;a11=lunarMonth11(yy-1);}else{lunarYear=yy+1;b11=lunarMonth11(yy+1);}
  const lunarDay=dayNumber-monthStart+1;
  const diff=Math.floor((monthStart-a11)/29);
  let lunarMonth=diff+11;
  if(b11-a11>365){
    const leap=leapMonthOffset(a11);
    if(diff>=leap)lunarMonth=diff+10;
  }
  if(lunarMonth>12)lunarMonth-=12;
  if(lunarMonth>=11&&diff<4)lunarYear-=1;
  return {day:lunarDay,month:lunarMonth,year:lunarYear};
}
function lunarSignals(date){
  const lunar=solarToLunar(date);
  return [
    String(lunar.day).padStart(2,"0"),
    String(lunar.month).padStart(2,"0"),
    `${String(lunar.day).slice(-1)}${String(lunar.month).slice(-1)}`,
    `${String(lunar.month).slice(-1)}${String(lunar.day).slice(-1)}`
  ];
}

function numbersFromHeads(heads){
  return heads.flatMap(head=>Array.from({length:10},(_,tail)=>`${head}${tail}`));
}

function nextDayHeadRule(head){
  const map={
    "3":["6","7"],
    "9":["0","1"],
    "7":["2","3"],
    "8":["1","2"],
    "5":["4","6"]
  };
  return map[head]||[];
}

function patternDefinitions(result){
  const db=two(result.special);
  const last=String(db).slice(-1);
  const first=String(db)[0];
  const prevLoto=[...new Set(lotoNumbers(result))];
  const hotHeads=[...headCounts(result).entries()]
    .filter(([,count])=>count>=4)
    .map(([head])=>String(head));
  const headRule=nextDayHeadRule(first);
  const rules=[
    {key:"db-prev",name:"2 số ĐB hôm trước",numbers:[db],scope:"both"},
    {key:"db-reverse",name:"Đảo 2 số ĐB hôm trước",numbers:[reverse2(db)],scope:"both"},
    {key:"db-complement-100",name:"Tổng ĐB hôm trước và hôm nay = 100",numbers:[complement100(db)],scope:"both"},
    {key:"db-sum",name:"Tổng 2 số ĐB hôm trước",numbers:[sumDigits2(db)],scope:"both"},
    {key:"db-head-tail",name:"Ghép đầu/đuôi ĐB hôm trước",numbers:[`${last}${first}`],scope:"both"},
    {key:"solar",name:"Ngày dương hôm trước",numbers:solarSignals(result.date),scope:"both"},
    {key:"lunar",name:"Ngày âm hôm trước",numbers:lunarSignals(result.date),scope:"both"},
    {key:"repeat-loto",name:"Lô hôm trước lặp lại",numbers:prevLoto,scope:"lo",dynamic:"repeat-loto"},
    {key:"reverse-loto",name:"Đảo lô hôm trước",numbers:prevLoto.map(reverse2),scope:"lo",dynamic:"reverse-loto"}
  ];
  hotHeads.forEach(head=>{
    rules.push({
      key:`hot-head-${head}`,
      name:`Đầu ${head} về dày hôm trước`,
      numbers:numbersFromHeads([head]),
      scope:"lo",
      dynamic:"hot-head",
      sourceHead:head
    });
  });
  if(headRule.length){
    rules.push({
      key:`db-head-rule-${first}`,
      name:`Đầu ${first} ĐB hôm trước hay ra đầu ${headRule.join(" và ")}`,
      numbers:numbersFromHeads(headRule),
      sourceHead:first,
      scope:"both"
    });
  }
  return rules.map(rule=>({...rule,numbers:[...new Set(rule.numbers.map(two))]}));
}

function autoCandidateRules(result){
  const db=two(result.special);
  const first=db[0],last=db[1];
  const sum=sumDigits2(db);
  const baseLabel=displayDate(result.date);
  const prevLoto=[...new Set(lotoNumbers(result))];
  const heads=headCounts(result).map((count,head)=>({head:String(head),count}))
    .filter(x=>x.count>=3)
    .sort((a,b)=>b.count-a.count||a.head.localeCompare(b.head))
    .slice(0,4);
  const rules=[
    {key:`auto-db-${db}`,name:`Từ ${baseLabel}: ĐB đuôi ${db}`,numbers:[db],dynamic:"db-prev"},
    {key:`auto-dao-${db}`,name:`Từ ${baseLabel}: đảo ĐB ${db}`,numbers:[reverse2(db)],dynamic:"db-reverse"},
    {key:`auto-bu-100-${db}`,name:`Từ ${baseLabel}: bù 100 ĐB ${db}`,numbers:[complement100(db)],dynamic:"db-complement-100"},
    {key:`auto-tong-${sum}`,name:`Từ ${baseLabel}: tổng ĐB ${sum}`,numbers:[sum],dynamic:"db-sum"},
    {key:`auto-cham-${first}`,name:`Từ ${baseLabel}: chạm đầu ĐB ${first}`,numbers:numbersFromHeads([first]),dynamic:"db-head"},
    {key:`auto-duoi-${last}`,name:`Từ ${baseLabel}: đuôi ĐB ${last}`,numbers:Array.from({length:10},(_,h)=>`${h}${last}`),dynamic:"db-tail"},
    {key:"auto-solar",name:`Từ ${baseLabel}: tín hiệu ngày dương`,numbers:solarSignals(result.date),dynamic:"solar"},
    {key:"auto-lunar",name:`Từ ${baseLabel}: tín hiệu ngày âm`,numbers:lunarSignals(result.date),dynamic:"lunar"},
    {key:"auto-repeat-top",name:`Từ ${baseLabel}: lô đã về`,numbers:prevLoto,dynamic:"repeat-loto"},
    {key:"auto-reverse-top",name:`Từ ${baseLabel}: đảo lô đã về`,numbers:prevLoto.map(reverse2),dynamic:"reverse-loto"}
  ];
  heads.forEach(({head,count})=>{
    rules.push({
      key:`auto-head-${head}`,
      name:`Từ ${baseLabel}: đầu ${head} có ${count} nháy`,
      numbers:numbersFromHeads([head]),
      dynamic:"hot-head",
      sourceHead:head
    });
  });
  return rules.map(rule=>({...rule,numbers:[...new Set(rule.numbers.map(two))]}));
}

function getPatternContext(yearValue,baseDateValue){
  const year=yearValue||String(new Date().getFullYear());
  const results=stateCache.results
    .filter(r=>year==="all"||String(r.date).startsWith(`${year}-`));
  const byDate=new Map(results.map(r=>[r.date,r]));
  const baseDate=baseDateValue||addDate(today(),-1);
  const baseResult=byDate.get(baseDate)||results.filter(r=>r.date<today()).at(-1)||results.at(-1);
  const rows=baseResult?patternDefinitions(baseResult)
    .map(rule=>evaluatePatternRule(rule,results,byDate,baseResult.date))
    .sort((a,b)=>b.rate-a.rate||b.hit-a.hit):[];
  return {year,results,byDate,baseResult,rows};
}

function renderForecastStats(){
  renderPatternYearOptions();
  syncPatternBaseDate("forecast","#patternBaseDate","#patternYear");
  const {year,results,byDate,baseResult,rows}=getPatternContext($("#patternYear").value,$("#patternBaseDate").value);
  if(baseResult&&$("#patternBaseDate").value!==baseResult.date)$("#patternBaseDate").value=baseResult.date;
  const autoRows=baseResult?buildAutoRowsForBase(baseResult,results,byDate):[];
  const loAuto=autoRows.filter(row=>row.target==="lo").slice(0,6);
  const dbAuto=autoRows.filter(row=>row.target==="db").slice(0,6);
  const allocation=buildReferenceAllocation(autoRows,$("#referenceMode").value);
  allocation.forecastDate=baseResult?addDate(baseResult.date,1):"";
  const nextResult=baseResult?stateCache.resultsByDate.get(allocation.forecastDate):null;
  allocation.performance=nextResult?evaluateReferencePerformance(allocation,nextResult):null;
  allocation.monthly=baseResult?buildReferenceMonthBacktest($("#referenceBacktestMonth").value,results,byDate,$("#referenceMode").value):null;
  allocation.signal=referenceSignal(allocation);
  const loReference=allocation.lo;
  const dbReference=allocation.de;
  const lawNumbers=buildLawReferenceNumbers(rows);
  const historyTotal=rows[0]?.total||0;
  $("#forecastStats").innerHTML=`
    <div class="stat-grid">
      <div class="stat-card">Năm phân tích<strong>${year==="all"?"Tất cả":year}</strong></div>
      <div class="stat-card">Ngày so sánh<strong>${baseResult?displayDate(baseResult.date):"-"}</strong><small>${baseResult?`ĐB ${baseResult.special}`:"Chưa có dữ liệu"}</small></div>
      <div class="stat-card">Mẫu quá khứ<strong>${historyTotal}</strong><small>Chỉ dùng các ngày trước ngày so sánh</small></div>
    </div>
    <p class="muted">Các quy luật dưới đây chỉ là thống kê tham khảo từ dữ liệu đã nhập, không đảm bảo kết quả tương lai.</p>
    ${renderReferenceNumbers(loReference,dbReference,allocation)}
    <div class="pattern-grid auto-pattern-grid">
      <div>
        <h3>Máy gợi ý lô${baseResult?` từ ${displayDate(baseResult.date)}`:""}</h3>
        ${loAuto.length?renderAutoPatternList(loAuto):'<p class="muted">Chưa đủ mẫu để tự dò lô.</p>'}
      </div>
      <div>
        <h3>Máy gợi ý ĐB${baseResult?` từ ${displayDate(baseResult.date)}`:""}</h3>
        ${dbAuto.length?renderAutoPatternList(dbAuto):'<p class="muted">Chưa đủ mẫu để tự dò ĐB.</p>'}
      </div>
    </div>
    <div class="pattern-grid">
      <div>
        ${renderLawReferenceNumbers(lawNumbers)}
        <h3>Gợi ý theo quy luật</h3>
        ${rows.length?renderPatternSuggestionList(rows.slice(0,5)):'<p class="muted">Chưa có dữ liệu.</p>'}
      </div>
      <div>
        <h3>Tóm tắt xác suất</h3>
        ${renderPatternTable(rows.slice(0,8))}
      </div>
    </div>`;
}

function renderPatternStats(){
  renderLawYearOptions();
  syncPatternBaseDate("law","#lawBaseDate","#lawYear");
  const {year,results,byDate,baseResult,rows}=getPatternContext($("#lawYear").value,$("#lawBaseDate").value);
  if(baseResult&&$("#lawBaseDate").value!==baseResult.date)$("#lawBaseDate").value=baseResult.date;
  const allocation=buildLawAllocation(rows,$("#lawReferenceMode").value);
  allocation.forecastDate=baseResult?addDate(baseResult.date,1):"";
  const nextResult=baseResult?stateCache.resultsByDate.get(allocation.forecastDate):null;
  allocation.performance=nextResult?evaluateReferencePerformance(allocation,nextResult):null;
  allocation.monthly=baseResult?buildLawMonthBacktest($("#lawBacktestMonth").value,results,byDate,$("#lawReferenceMode").value):null;
  allocation.signal=referenceSignal(allocation);
  const lawNumbers=buildLawReferenceNumbers(rows);
  const historyTotal=rows[0]?.total||0;
  $("#patternStats").innerHTML=`
    <div class="stat-grid">
      <div class="stat-card">Năm phân tích<strong>${year==="all"?"Tất cả":year}</strong></div>
      <div class="stat-card">Ngày so sánh<strong>${baseResult?displayDate(baseResult.date):"-"}</strong><small>${baseResult?`ĐB ${baseResult.special}`:"Chưa có dữ liệu"}</small></div>
      <div class="stat-card">Mẫu quá khứ<strong>${historyTotal}</strong><small>Chỉ dùng các ngày trước ngày so sánh</small></div>
    </div>
    <p class="muted">Bảng này dùng riêng các quy luật tỷ lệ cao để tạo dãy số và phân bổ điểm.</p>
    ${renderReferenceNumbers(allocation.lo,allocation.de,allocation)}
    <div class="pattern-grid">
      <div>
        ${renderLawReferenceNumbers(lawNumbers)}
        <h3>Gợi ý tham khảo cho hôm nay</h3>
        ${rows.length?renderPatternSuggestionList(rows):'<p class="muted">Chưa có dữ liệu.</p>'}
      </div>
      <div>
        <h3>Xác suất quá khứ</h3>
        ${renderPatternTable(rows)}
      </div>
    </div>`;
}

function resultScopeKey(results){
  return `${results.length}:${results[0]?.date||""}:${results.at(-1)?.date||""}`;
}

function buildAutoRowsForBase(baseResult,results,byDate){
  const key=`${baseResult.date}|${resultScopeKey(results)}`;
  if(autoRowsCache.has(key))return autoRowsCache.get(key);
  const history=results.filter(r=>r.date<baseResult.date).slice(-AUTO_HISTORY_LIMIT);
  const rows=autoCandidateRules(baseResult)
    .flatMap(rule=>[
      evaluateAutoPatternRule({...rule,target:"lo"},history,byDate,baseResult.date),
      evaluateAutoPatternRule({...rule,target:"db"},history,byDate,baseResult.date)
    ])
    .filter(row=>row.total>=20&&row.hit>0&&row.score>0)
    .sort((a,b)=>b.score-a.score||b.rate-a.rate||b.hit-a.hit);
  autoRowsCache.set(key,rows);
  return rows;
}

function evaluatePatternRule(rule,results,byDate,baseDate){
  let total=0,hit=0;
  const recent=[];
  results.filter(r=>r.date<baseDate).forEach(result=>{
    if(rule.sourceHead&&two(result.special)[0]!==rule.sourceHead)return;
    const next=byDate.get(addDate(result.date,1));
    if(!next)return;
    const nextLoto=new Set(lotoNumbers(next));
    const hitNumbers=rule.numbers.filter(n=>nextLoto.has(n));
    total++;
    if(hitNumbers.length)hit++;
    recent.push({date:result.date,nextDate:next.date,hitNumbers});
  });
  return {...rule,total,hit,rate:total?hit/total:0,recent};
}

function buildLawReferenceNumbers(rows){
  const map=new Map();
  rows
    .filter(rule=>rule.total>=20&&rule.rate>=0.2)
    .slice(0,8)
    .forEach(rule=>{
      const widthPenalty=Math.sqrt(Math.max(1,rule.numbers.length));
      const weight=(rule.rate*Math.log10(rule.total+1))/widthPenalty;
      rule.numbers.forEach((number,index)=>{
        const current=map.get(number)||{number,score:0,count:0,bestRate:0,firstIndex:index};
        current.score+=weight;
        current.count++;
        current.bestRate=Math.max(current.bestRate,rule.rate);
        current.firstIndex=Math.min(current.firstIndex,index);
        map.set(number,current);
      });
    });
  return [...map.values()]
    .sort((a,b)=>b.score-a.score||b.count-a.count||b.bestRate-a.bestRate||a.firstIndex-b.firstIndex||a.number.localeCompare(b.number))
    .slice(0,24)
    .map(x=>x.number);
}

function buildLawCandidates(rows,limit){
  const map=new Map();
  rows
    .filter(rule=>rule.total>=20&&rule.rate>=0.2)
    .slice(0,10)
    .forEach(rule=>{
      const widthPenalty=Math.sqrt(Math.max(1,rule.numbers.length));
      const weight=(rule.rate*Math.log10(rule.total+1))/widthPenalty;
      rule.numbers.forEach((number,index)=>{
        const current=map.get(number)||{number,score:0,count:0,bestRate:0,firstIndex:index};
        current.score+=weight;
        current.count++;
        current.bestRate=Math.max(current.bestRate,rule.rate);
        current.firstIndex=Math.min(current.firstIndex,index);
        map.set(number,current);
      });
    });
  return [...map.values()]
    .sort((a,b)=>b.score-a.score||b.count-a.count||b.bestRate-a.bestRate||a.firstIndex-b.firstIndex||a.number.localeCompare(b.number))
    .slice(0,limit);
}

function buildLawAllocation(rows,mode){
  const strong=mode==="strong";
  const candidates=buildLawCandidates(rows,strong?22:14);
  const confidence=candidates.slice(0,8).reduce((sum,x)=>sum+x.score,0)/Math.sqrt(Math.max(1,Math.min(8,candidates.length)));
  const weak=confidence<0.22;
  const target=strong?(weak?520:900):(weak?260:480);
  const loCandidates=candidates.map((x,index)=>({...x,index,type:"lo"}));
  const deCandidates=candidates.slice(0,strong?10:6).map((x,index)=>({...x,index,type:"de"}));
  const lo=applyStakeBudget(loCandidates.slice(0,strong?9:5),"lo",Math.round(target*(strong?0.55:0.5)));
  const de=applyStakeBudget(deCandidates.slice(0,strong?6:3),"de",Math.round(target*(strong?0.45:0.5)));
  return {
    lo,
    de,
    pool:candidates.map(x=>x.number),
    confidence,
    mode:`Quy luật · ${strong?"Kết mạnh":"Đánh vui"}${weak?" · tín hiệu yếu":""}`,
    target,
    totalCost:referenceCost(lo,"lo")+referenceCost(de,"de")
  };
}

function buildLawMonthBacktest(month,results,byDate,mode){
  if(!month)return null;
  const cacheKey=`law|${month}|${mode}|${resultScopeKey(results)}`;
  if(lawMonthBacktestCache.has(cacheKey))return lawMonthBacktestCache.get(cacheKey);
  const rows=[];
  results.filter(r=>String(r.date).startsWith(`${month}-`)).forEach(base=>{
    const next=byDate.get(addDate(base.date,1));
    if(!next)return;
    const ruleRows=patternDefinitions(base)
      .map(rule=>evaluatePatternRule(rule,results,byDate,base.date))
      .sort((a,b)=>b.rate-a.rate||b.hit-a.hit);
    const allocation=buildLawAllocation(ruleRows,mode);
    rows.push({baseDate:base.date,nextDate:next.date,allocation,perf:evaluateReferencePerformance(allocation,next)});
  });
  const total=rows.reduce((sum,row)=>{
    sum.cost+=row.perf.cost; sum.reward+=row.perf.reward; sum.net+=row.perf.net;
    sum.loHits+=row.perf.loHits; sum.deHits+=row.perf.deHits;
    return sum;
  },{cost:0,reward:0,net:0,loHits:0,deHits:0});
  const backtest={month,rows,total};
  lawMonthBacktestCache.set(cacheKey,backtest);
  return backtest;
}

function dynamicRuleNumbers(rule,result){
  const db=two(result.special);
  if(rule.dynamic==="db-prev")return [db];
  if(rule.dynamic==="db-reverse")return [reverse2(db)];
  if(rule.dynamic==="db-complement-100")return [complement100(db)];
  if(rule.dynamic==="db-sum")return [sumDigits2(db)];
  if(rule.dynamic==="db-head")return numbersFromHeads([db[0]]);
  if(rule.dynamic==="db-tail")return Array.from({length:10},(_,head)=>`${head}${db[1]}`);
  if(rule.dynamic==="solar")return solarSignals(result.date);
  if(rule.dynamic==="lunar")return lunarSignals(result.date);
  if(rule.dynamic==="repeat-loto")return [...new Set(lotoNumbers(result))];
  if(rule.dynamic==="reverse-loto")return [...new Set(lotoNumbers(result).map(reverse2))];
  if(rule.dynamic==="hot-head"){
    const head=rule.sourceHead||"";
    if(!head)return [];
    const count=headCounts(result)[Number(head)]||0;
    return count>=3?numbersFromHeads([head]):[];
  }
  return rule.numbers;
}

function evaluateAutoPatternRule(rule,results,byDate,baseDate){
  let total=0,hit=0;
  const recent=[];
  results.filter(r=>r.date<baseDate).forEach(result=>{
    const nums=[...new Set(dynamicRuleNumbers(rule,result).map(two))];
    if(!nums.length)return;
    const next=byDate.get(addDate(result.date,1));
    if(!next)return;
    const nextNumbers=rule.target==="db"?new Set([two(next.special)]):new Set(lotoNumbers(next));
    const hitNumbers=nums.filter(n=>nextNumbers.has(n));
    total++;
    if(hitNumbers.length){
      hit++;
    }
    recent.push({date:result.date,nextDate:next.date,hitNumbers});
  });
  const rate=total?hit/total:0;
  const suggested=rule.numbers.slice(0,30);
  const chanceCount=Math.min(rule.numbers.length||1,100);
  const baseline=rule.target==="db"?chanceCount/100:1-Math.pow(1-chanceCount/100,27);
  const score=(rate-baseline)*Math.log10(total+1);
  return {...rule,total,hit,rate,score,recent,numbers:suggested};
}

function collectReferenceCandidates(rules,limit,type){
  const map=new Map();
  rules.forEach(rule=>{
    const weight=Math.max(0.01,rule.score+rule.rate);
    rule.numbers.forEach((number,index)=>{
      const current=map.get(number)||{number,score:0,count:0,bestRate:0,firstIndex:index};
      current.score+=weight;
      current.count++;
      current.bestRate=Math.max(current.bestRate,rule.rate);
      current.firstIndex=Math.min(current.firstIndex,index);
      map.set(number,current);
    });
  });
  return [...map.values()]
    .sort((a,b)=>b.score-a.score||b.count-a.count||b.bestRate-a.bestRate||a.firstIndex-b.firstIndex||a.number.localeCompare(b.number))
    .slice(0,limit)
    .map((x,index)=>({...x,index,type}));
}

function buildReferenceAllocation(autoRows,mode){
  const loRules=autoRows.filter(row=>row.target==="lo");
  const deRules=autoRows.filter(row=>row.target==="db");
  const confidence=referenceConfidence([...loRules,...deRules]);
  const strong=mode==="strong";
  const weak=confidence<0.14;
  const veryWeak=confidence<0.08;
  const target=strong?(veryWeak?180:weak?520:920):(veryWeak?120:weak?260:420);
  const loBudget=Math.round(target*(strong?0.56:0.52));
  const deBudget=target-loBudget;
  const loCandidates=collectReferenceCandidates(loRules,strong?14:7,"lo").filter(x=>x.score>=0.05||x.count>1);
  const deCandidates=collectReferenceCandidates(deRules,strong?10:5,"de").filter(x=>x.score>=0.035||x.count>1);
  const lo=veryWeak?[]:applyStakeBudget(loCandidates.slice(0,strong?8:4),"lo",loBudget);
  const de=veryWeak?applyStakeBudget(deCandidates.slice(0,2),"de",deBudget):applyStakeBudget(deCandidates.slice(0,strong?5:3),"de",deBudget);
  return {
    lo,
    de,
    pool:referencePool(loCandidates,deCandidates),
    confidence,
    mode:`${strong?"Kết mạnh":"Đánh vui"}${veryWeak?" · nên bỏ":weak?" · tín hiệu yếu":""}`,
    target,
    totalCost:referenceCost(lo,"lo")+referenceCost(de,"de")
  };
}

function referencePool(loCandidates,deCandidates){
  const map=new Map();
  [...loCandidates,...deCandidates].forEach(item=>{
    const current=map.get(item.number)||{number:item.number,score:0,count:0};
    current.score+=item.score;
    current.count+=item.count||1;
    map.set(item.number,current);
  });
  return [...map.values()]
    .sort((a,b)=>b.score-a.score||b.count-a.count||a.number.localeCompare(b.number))
    .map(x=>x.number);
}

function buildReferenceMonthBacktest(month,results,byDate,mode){
  if(!month)return null;
  const cacheKey=`${month}|${mode}|${resultScopeKey(results)}`;
  if(monthBacktestCache.has(cacheKey))return monthBacktestCache.get(cacheKey);
  const days=results.filter(r=>String(r.date).startsWith(`${month}-`));
  const rows=[];
  days.forEach(base=>{
    const next=byDate.get(addDate(base.date,1));
    if(!next)return;
    const autoRows=buildAutoRowsForBase(base,results,byDate);
    const allocation=buildReferenceAllocation(autoRows,mode);
    const perf=evaluateReferencePerformance(allocation,next);
    rows.push({baseDate:base.date,nextDate:next.date,allocation,perf});
  });
  const total=rows.reduce((sum,row)=>{
    sum.cost+=row.perf.cost;
    sum.reward+=row.perf.reward;
    sum.net+=row.perf.net;
    sum.loHits+=row.perf.loHits;
    sum.deHits+=row.perf.deHits;
    return sum;
  },{cost:0,reward:0,net:0,loHits:0,deHits:0});
  const backtest={month,rows,total};
  monthBacktestCache.set(cacheKey,backtest);
  return backtest;
}

function evaluateReferencePerformance(allocation,nextResult){
  const nextLoto=lotoNumbers(nextResult);
  const nextSpecial=two(nextResult.special);
  const rows=[];
  let cost=0,reward=0,loHits=0,deHits=0;
  allocation.lo.forEach(pick=>{
    const hits=nextLoto.filter(n=>n===pick.number).length;
    const rowCost=pick.stake*23;
    const rowReward=hits*pick.stake*80;
    cost+=rowCost; reward+=rowReward; loHits+=hits;
    if(hits)rows.push(`Lô ${pick.number} x${hits}`);
  });
  allocation.de.forEach(pick=>{
    const hit=nextSpecial===pick.number?1:0;
    const rowCost=pick.stake;
    const rowReward=hit*pick.stake*80;
    cost+=rowCost; reward+=rowReward; deHits+=hit;
    if(hit)rows.push(`Đề ${pick.number}`);
  });
  return {date:nextResult.date,cost,reward,net:reward-cost,loHits,deHits,hits:rows};
}

function referenceSignal(allocation){
  const month=allocation.monthly;
  const avgNet=month?.rows.length?month.total.net/month.rows.length:null;
  const roi=month?.total.cost?month.total.net/month.total.cost:0;
  if(!allocation.pool.length||allocation.confidence<0.08){
    return {level:"skip",title:"Nên bỏ qua",date:allocation.forecastDate,text:"Tín hiệu quá mỏng, không nên cố đánh để tránh âm."};
  }
  if(avgNet!==null&&avgNet<-180){
    return {level:"skip",title:"Nên bỏ qua",date:allocation.forecastDate,text:`Test tháng đang âm trung bình ${Math.round(avgNet)} điểm/ngày.`};
  }
  if(allocation.confidence>=0.24&&roi>-0.12){
    return {level:"strong",title:"Có thể kết mạnh",date:allocation.forecastDate,text:"Tín hiệu khá rõ, nhưng vẫn nên kiểm tra dãy số trước khi ghi."};
  }
  if(allocation.confidence>=0.14&&(!month||roi>-0.32)){
    return {level:"fun",title:"Nên đánh vui",date:allocation.forecastDate,text:"Có tín hiệu nhưng chưa đủ đẹp để dồn mạnh."};
  }
  return {level:"skip",title:"Đánh rất nhẹ hoặc bỏ",date:allocation.forecastDate,text:"Tỷ lệ lịch sử chưa đủ tốt, ưu tiên giữ điểm."};
}

function referenceConfidence(rules){
  const sorted=[...rules].sort((a,b)=>b.score-a.score||b.rate-a.rate).slice(0,6);
  if(!sorted.length)return 0;
  return sorted.reduce((sum,rule)=>sum+Math.max(0,rule.score),0)/Math.sqrt(sorted.length);
}

function applyStakeBudget(candidates,type,budget){
  const picks=[];
  let spent=0;
  const unit=type==="lo"?23:1;
  const strong=budget>(type==="lo"?350:250);
  const tiers=type==="de"?(strong?[60,40,30,20,10]:[40,30,20,10]):(strong?[10,7,5,3,2,1]:[6,4,3,2,1]);
  const maxByRank=type==="de"?(strong?[120,90,70,50,30,20,10]:[70,50,30,20,10]):(strong?[16,12,9,6,4,3,2,1]:[9,6,4,3,2,1]);
  candidates.forEach((candidate,index)=>{
    let stake=tiers[Math.min(index,tiers.length-1)];
    if(type==="de"&&stake<10)stake=10;
    while(stake>0&&spent+stake*unit>budget)stake-=type==="de"?10:1;
    if(type==="de"&&stake<10)return;
    if(type==="lo"&&stake<1)return;
    picks.push({...candidate,stake});
    spent+=stake*unit;
  });
  for(let round=0;round<80;round++){
    let changed=false;
    for(let i=0;i<picks.length;i++){
      const pick=picks[i];
      const step=type==="de"?10:1;
      const maxStake=maxByRank[Math.min(i,maxByRank.length-1)];
      if(pick.stake+step>maxStake)continue;
      if(spent+step*unit>budget)continue;
      pick.stake+=step;
      spent+=step*unit;
      changed=true;
    }
    if(!changed)break;
  }
  return picks;
}

function referenceCost(picks,type){
  const points=picks.reduce((sum,p)=>sum+p.stake,0);
  return type==="lo"?points*23:points;
}

function referenceCopyText(picks,type){
  const groups=new Map();
  picks.forEach(p=>{
    if(!groups.has(p.stake))groups.set(p.stake,[]);
    groups.get(p.stake).push(p.number);
  });
  return [...groups.entries()]
    .sort((a,b)=>b[0]-a[0])
    .map(([stake,numbers])=>`${numbers.join("-")} ${stake}${type==="de"?"k":"đ"}`)
    .join("\n");
}

function combinedReferenceCopyText(loPicks,dePicks){
  const lo=referenceCopyText(loPicks,"lo");
  const de=referenceCopyText(dePicks,"de");
  return [lo&&`Lô:\n${lo}`,de&&`Đề:\n${de}`].filter(Boolean).join("\n");
}

function renderReferenceNumbers(loPicks,dbPicks,allocation){
  if(!loPicks.length&&!dbPicks.length&&!allocation.pool?.length&&!allocation.monthly)return "";
  return `<div class="reference-box">
    <div class="reference-head">
      <h3>Phân bổ điểm tham khảo</h3>
      <div class="reference-head-actions"><small>${allocation.mode} · mục tiêu ${allocation.target} · đang trừ ${allocation.totalCost}</small>
        <button class="secondary" type="button" data-text="${esc(combinedReferenceCopyText(loPicks,dbPicks))}" onclick="copyReferenceText(this.dataset.text)">Copy cả lô + đề</button>
      </div>
    </div>
    ${renderReferenceSignal(allocation.signal)}
    ${renderReferencePool(allocation.pool)}
    ${renderReferencePerformance(allocation.performance)}
    <div class="allocation-toolbar">
      <strong>${allocation.mode} · mục tiêu ${allocation.target} · đang trừ ${allocation.totalCost}</strong>
      <button class="secondary" type="button" data-text="${esc(combinedReferenceCopyText(loPicks,dbPicks))}" onclick="copyReferenceText(this.dataset.text)">Copy cả lô + đề</button>
    </div>
    <div class="reference-grid">
      ${renderReferenceGroup("Lô tham khảo",loPicks,"lo")}
      ${renderReferenceGroup("Đề tham khảo",dbPicks,"de")}
    </div>
    ${renderReferenceMonthBacktest(allocation.monthly)}
  </div>`;
}

function renderReferenceSignal(signal){
  if(!signal)return "";
  const title=signal.date?`${signal.title} ngày ${displayDate(signal.date)}`:signal.title;
  return `<div class="reference-signal ${signal.level}">
    <strong>${esc(title)}</strong>
    <span>${esc(signal.text)}</span>
  </div>`;
}

function renderReferencePool(numbers){
  if(!numbers?.length)return "";
  const text=numbers.join("-");
  return `<div class="reference-all">
    <div class="reference-title">
      <strong>Dãy số tham khảo</strong>
      <button class="secondary" type="button" data-text="${esc(text)}" onclick="copyReferenceText(this.dataset.text)">Copy dãy</button>
    </div>
    <div class="reference-numbers">${numbers.map(n=>`<span>${n}</span>`).join("")}</div>
    <small>${esc(text)}</small>
  </div>`;
}

function renderReferencePerformance(perf){
  if(!perf)return '<div class="reference-result muted">Chưa có kết quả ngày hôm sau để chấm phân bổ này.</div>';
  return `<div class="reference-result">
    <strong>Chấm ngày ${displayDate(perf.date)}</strong>
    <span>Trúng: ${perf.hits.length?perf.hits.join(", "):"Không trúng"}</span>
    <span>Trừ <b>${perf.cost}</b></span>
    <span>Cộng <b>${perf.reward}</b></span>
    <span>Chênh <b class="${perf.net>=0?'positive':'negative'}">${perf.net>=0?'+':''}${perf.net}</b></span>
  </div>`;
}

function renderReferenceMonthBacktest(backtest){
  if(!backtest)return "";
  if(!backtest.rows.length)return `<div class="reference-month"><strong>Test tháng ${esc(backtest.month)}</strong><p class="muted">Chưa đủ cặp ngày liên tiếp để chấm.</p></div>`;
  const rows=[...backtest.rows].reverse();
  return `<div class="reference-month">
    <div class="reference-title">
      <strong>Test tháng ${esc(backtest.month)}</strong>
      <span class="${backtest.total.net>=0?'positive':'negative'}">${backtest.total.net>=0?'+':''}${backtest.total.net}</span>
    </div>
    <div class="reference-metrics">
      <span>Ngày test: <strong>${backtest.rows.length}</strong></span>
      <span>Trừ: <strong>${backtest.total.cost}</strong></span>
      <span>Cộng: <strong>${backtest.total.reward}</strong></span>
      <span>Lô trúng: <strong>${backtest.total.loHits}</strong></span>
      <span>Đề trúng: <strong>${backtest.total.deHits}</strong></span>
    </div>
    <div class="table-wrap compact-table">
      <table>
        <thead><tr><th>Ngày soi</th><th>Chấm ngày</th><th>Trúng</th><th>Trừ</th><th>Cộng</th><th>+/-</th></tr></thead>
        <tbody>${rows.map(row=>`<tr class="${row.perf.net>=0?'month-positive':'month-negative'}">
          <td>${displayDate(row.baseDate)}</td>
          <td>${displayDate(row.nextDate)}</td>
          <td>${row.perf.hits.length?esc(row.perf.hits.join(", ")):"-"}</td>
          <td>${row.perf.cost}</td>
          <td>${row.perf.reward}</td>
          <td><strong class="${row.perf.net>=0?'positive':'negative'}">${row.perf.net>=0?'+':''}${row.perf.net}</strong></td>
        </tr>`).join("")}</tbody>
      </table>
    </div>
  </div>`;
}

function renderReferenceGroup(title,picks,type,editable=false){
  const text=referenceCopyText(picks,type);
  const cost=referenceCost(picks,type);
  const top=picks[0];
  const bestNet=top?top.stake*80-cost:0;
  return `<div class="reference-group"${editable?` data-allocation-type="${type}"`:""}>
    <div class="reference-title">
      <strong>${title}</strong>
    </div>
    <div class="reference-metrics">
      <span>${type==="lo"?"Điểm trừ tối đa":"Vốn đề"}: <strong data-allocation-cost>${cost}</strong></span>
      ${top?`<span>Trúng top 1: <strong data-allocation-net class="${bestNet>=0?'positive':'negative'}">${bestNet>=0?'+':''}${bestNet}</strong></span>`:""}
    </div>
    <div class="reference-numbers ${type}">${picks.length?picks.map((p,index)=>`
      <span class="${editable?'editable-stake':''}"${editable?` data-number="${p.number}"`:""} title="Tỷ lệ tốt nhất ${Math.round(p.bestRate*100)}%, xuất hiện trong ${p.count} rule">
        ${p.number}${editable?`<span class="stake-stepper">
          <button type="button" aria-label="Giảm điểm số ${p.number}" data-stake-action="minus">−</button>
          <input type="number" min="0" step="${type==="de"?10:1}" value="${p.stake}" data-stake-input data-top="${index===0?'1':'0'}" aria-label="Điểm phân bổ cho số ${p.number}">
          <button type="button" aria-label="Tăng điểm số ${p.number}" data-stake-action="plus">+</button>
        </span>`:`<small>${p.stake}${type==="de"?"k":"đ"}</small>`}
      </span>`).join(""):'<em>Chưa đủ dữ liệu</em>'}</div>
    ${picks.length?`<small${editable?' data-allocation-summary':''}>${esc(text).replace(/\n/g,"<br>")}</small>`:""}
  </div>`;
}

function updateManualAllocation(group){
  const type=group.dataset.allocationType;
  const inputs=[...group.querySelectorAll("[data-stake-input]")];
  inputs.forEach(input=>{
    const value=Math.max(0,Number(input.value)||0);
    input.value=String(value);
  });
  const cost=inputs.reduce((sum,input)=>sum+Number(input.value),0)*(type==="lo"?23:1);
  const topStake=Number(inputs.find(input=>input.dataset.top==="1")?.value)||0;
  const net=topStake*80-cost;
  group.querySelector("[data-allocation-cost]").textContent=String(cost);
  const netNode=group.querySelector("[data-allocation-net]");
  if(netNode){
    netNode.textContent=`${net>=0?'+':''}${net}`;
    netNode.className=net>=0?"positive":"negative";
  }
  const summary=group.querySelector("[data-allocation-summary]");
  const copyText=inputs.filter(input=>Number(input.value)>0)
    .map(input=>`${input.closest(".editable-stake").dataset.number} ${input.value}${type==="de"?"k":"đ"}`);
  if(summary){
    summary.innerHTML=copyText.join("<br>")||"Chưa phân bổ điểm";
  }
  const allButton=document.querySelector("#analyzeNumbersResult .allocation-toolbar [data-copy-all]");
  if(allButton){
    const groups=[...document.querySelectorAll("#analyzeNumbersResult [data-allocation-type]")];
    allButton.dataset.text=groups.map(item=>{
      const label=item.dataset.allocationType==="lo"?"Lô":"Đề";
      const lines=[...item.querySelectorAll("[data-stake-input]")].filter(node=>Number(node.value)>0)
        .map(node=>`${node.closest(".editable-stake").dataset.number} ${node.value}${item.dataset.allocationType==="de"?"k":"đ"}`);
      return lines.length?`${label}:\n${lines.join("\n")}`:"";
    }).filter(Boolean).join("\n");
  }
  const total=[...document.querySelectorAll("#analyzeNumbersResult [data-allocation-cost]")]
    .reduce((sum,node)=>sum+(Number(node.textContent)||0),0);
  const totalNode=document.querySelector("#analyzeNumbersResult [data-allocation-total]");
  if(totalNode)totalNode.textContent=totalNode.textContent.replace(/trừ\s+[\d.]+\s+điểm/i,`trừ ${total} điểm`);
}

$("#analyzeNumbersResult")?.addEventListener("click",event=>{
  const button=event.target.closest("[data-stake-action]");
  if(!button)return;
  const input=button.parentElement.querySelector("[data-stake-input]");
  const step=Number(input.step)||1;
  input.value=String(Math.max(0,(Number(input.value)||0)+(button.dataset.stakeAction==="plus"?step:-step)));
  updateManualAllocation(button.closest("[data-allocation-type]"));
});

$("#analyzeNumbersResult")?.addEventListener("input",event=>{
  if(event.target.matches("[data-stake-input]"))updateManualAllocation(event.target.closest("[data-allocation-type]"));
});

$("#analyzeNumbersResult")?.addEventListener("click",event=>{
  const button=event.target.closest("[data-manual-mode]");
  if(!button)return;
  $("#referenceMode").value=button.dataset.manualMode;
  localStorage.setItem(REFERENCE_MODE_KEY,button.dataset.manualMode);
  renderManualNumberAnalysis();
});

async function copyReferenceText(text){
  try{
    await navigator.clipboard.writeText(text);
    lastSaveMessage="Đã copy dãy số tham khảo.";
    updateStorageStatus();
  }catch{
    prompt("Copy dãy số này",text);
  }
}
window.copyReferenceText=copyReferenceText;

function renderAutoPatternList(rules){
  return `<div class="pattern-list">${rules.map(rule=>{
    const recent=[...rule.recent].reverse().find(x=>x.hitNumbers.length);
    const rate=rule.total?Math.round(rule.rate*100):0;
    return `<div class="pattern-item auto-pattern-item">
      <strong>${esc(rule.name)} · ${rate}%</strong>
      <div>${rule.numbers.map(n=>`<span>${n}</span>`).join("")}</div>
      <small>${rule.hit}/${rule.total} mẫu${recent?` · gần nhất ${displayDate(recent.date)} -> ${displayDate(recent.nextDate)}: ${recent.hitNumbers.join(", ")}`:""}</small>
    </div>`;
  }).join("")}</div>`;
}

function renderPatternSuggestionList(rules){
  return `<div class="pattern-list">${rules.map(rule=>`
    <div class="pattern-item">
      <strong>${esc(rule.name)} · ${rule.total?Math.round(rule.rate*100):0}%</strong>
      <div>${rule.numbers.map(n=>`<span>${n}</span>`).join("")}</div>
      <small>${rule.hit||0}/${rule.total||0} lần trong quá khứ</small>
    </div>`).join("")}</div>`;
}

function renderLawReferenceNumbers(numbers){
  if(!numbers.length)return "";
  const text=numbers.join("-");
  return `<div class="law-reference">
    <div class="reference-title">
      <strong>Dãy theo quy luật</strong>
      <button class="secondary" type="button" data-text="${esc(text)}" onclick="copyReferenceText(this.dataset.text)">Copy dãy</button>
    </div>
    <div class="reference-numbers">${numbers.map(n=>`<span>${n}</span>`).join("")}</div>
    <small>${esc(text)}</small>
  </div>`;
}

function renderPatternTable(rows){
  if(!rows.length)return '<p class="muted">Chưa đủ cặp ngày liên tiếp để thống kê.</p>';
  return `<table class="special-table"><thead><tr><th>Quy luật</th><th>Trúng</th><th>Tỷ lệ</th><th>Gần nhất</th></tr></thead>
    <tbody>${rows.map(row=>{
      const recent=[...row.recent].reverse().find(x=>x.hitNumbers.length);
      const rate=Math.round(row.hit/row.total*100);
      return `<tr>
        <td>${esc(row.name)}</td>
        <td>${row.hit}/${row.total}</td>
        <td>${rate}%</td>
        <td>${recent?`${displayDate(recent.date)} -> ${displayDate(recent.nextDate)}: ${recent.hitNumbers.join(", ")}`:"-"}</td>
      </tr>`;
    }).join("")}</tbody></table>`;
}

function renderReport(){
  const allVisibleEntries=visibleEntries(state.entries);
  renderReportDateOptions(allVisibleEntries);
  const filter=$("#reportDate").value;
  const entries=allVisibleEntries.filter(e=>!filter||e.date===filter);
  const total=aggregate(entries);
  const net=total.reward-total.cost;
  const members=visibleMembers();
  const byMember=members.map(m=>{
    const memberEntries=entries.filter(e=>e.memberId===m.id);
    const a=aggregate(memberEntries);
    return {name:m.name,...a,net:a.reward-a.cost};
  }).filter(x=>x.count).sort((a,b)=>b.net-a.net);
  $("#reportCards").innerHTML=`
    <div class="stat-card">Tổng lượt<strong>${total.count}</strong><small>${total.pending} lượt chờ kết quả</small></div>
    <div class="stat-card">Điểm cộng / trừ<strong>${total.reward} / ${total.cost}</strong><small>${total.hits} lần trúng</small></div>
    <div class="stat-card">Chênh lệch<strong class="${net>=0?'positive':'negative'}">${net>=0?'+':''}${net}</strong><small>${filter?`Ngày ${displayDate(filter)}`:"Tất cả ngày"}</small></div>
    ${byMember.length?byMember.map(r=>`
      <div class="stat-card"><span class="pill">${esc(r.name)}</span>
      <strong class="${r.net>=0?'positive':'negative'}">${r.net>=0?'+':''}${r.net}</strong>
      <small>${r.count} lượt · cộng ${r.reward} · trừ ${r.cost}${r.pending?` · ${r.pending} chờ`:""}</small></div>`).join(""):'<p class="muted">Chưa có dữ liệu báo cáo.</p>'}`;
  renderPredictionSummary(entries);
}

function latestEntryDate(entries){
  return [...new Set(entries.map(e=>e.date).filter(Boolean))].sort((a,b)=>b.localeCompare(a))[0]||"";
}

function renderReportDateOptions(entries){
  const select=$("#reportDate");
  if(!select)return;
  const selected=select.value;
  const dates=[...new Set(entries.map(e=>e.date).filter(Boolean))].sort((a,b)=>b.localeCompare(a));
  select.innerHTML=dates.length?dates.map(date=>`<option value="${date}">${displayDate(date)}</option>`).join(""):'<option value="">Chưa có dự đoán</option>';
  select.value=dates.includes(selected)?selected:(dates[0]||"");
}

function renderPredictionSummary(entries){
  const target=$("#predictionSummary");
  if(!target)return;
  if(!entries.length){
    target.innerHTML='<p class="muted">Chưa có dự đoán để tổng hợp.</p>';
    return;
  }
  const byDate=new Map();
  [...entries].sort((a,b)=>b.date.localeCompare(a.date)).forEach(entry=>{
    if(!byDate.has(entry.date))byDate.set(entry.date,[]);
    byDate.get(entry.date).push(entry);
  });
  target.innerHTML=`<div class="prediction-summary-list">${[...byDate.entries()].map(([date,dayEntries])=>{
    const hasResult=Boolean(resultForDate(date));
    const members=visibleMembers().filter(m=>dayEntries.some(e=>e.memberId===m.id));
    return members.map(member=>{
      const memberEntries=dayEntries.filter(e=>e.memberId===member.id);
      const total=aggregate(memberEntries);
      const net=total.reward-total.cost;
      const hasPending=total.pending>0;
      const correct=countCorrectPredictions(memberEntries);
      const summaryRows=buildPredictionSummaryRows(memberEntries);
      const copyText=summaryRows.map(row=>row.copy).join("\n");
      return `<article class="prediction-summary-card">
        <div class="prediction-summary-head">
          <div><strong>${displayDate(date)}</strong><span>${esc(member.name)}</span><span class="${hasResult?'result-ready':'result-missing'}">${hasResult?'Đã có KQ':'Chưa có KQ'}</span></div>
          <button class="secondary prediction-copy" type="button" data-text="${esc(copyText)}" onclick="copyPredictionSummary(this.dataset.text)">Copy</button>
        </div>
        <div class="prediction-summary-metrics">
          <span>Dự đoán đúng <b>${correct}/${memberEntries.length}</b></span>
          <span>Trúng <b>${total.hits}</b> lần</span>
          <span>Điểm trừ <b class="negative">${total.cost}</b></span>
          <span>Điểm cộng <b class="positive">${hasPending?"-":total.reward}</b></span>
          <span>Thành tiền <b class="${hasPending?'pending':net>=0?'positive':'negative'}">${hasPending?"Chờ KQ":`${net>=0?'+':''}${net}`}</b></span>
        </div>
        <div class="prediction-lines">${renderPredictionSummaryGroups(summaryRows)}</div>
      </article>`;
    }).join("");
  }).join("")}</div>`;
}

function countCorrectPredictions(entries){
  return entries.reduce((sum,entry)=>{
    const c=calc(entry);
    return sum+(c.hits?1:0);
  },0);
}

function buildPredictionSummaryRows(entries){
  const rows=[];
  const grouped=new Map();
  entries.forEach(entry=>{
    const key=`${entry.type}|${entry.points}`;
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push(entry);
  });
  [...grouped.values()]
    .sort((a,b)=>(a[0].type==="lo"?0:1)-(b[0].type==="lo"?0:1)||b[0].points-a[0].points)
    .forEach(group=>{
      const numbers=[...new Set(group.map(e=>e.number))].sort().join(" - ");
      rows.push(buildPredictionLineRow(group[0].type,numbers,group[0].points,false,group));
    });
  return rows.sort((a,b)=>(a.type==="lo"?0:1)-(b.type==="lo"?0:1)||b.points-a.points);
}

function buildPredictionLineRow(type,numbers,points,isBatch,entries){
  const suffix=type==="lo"?"đ":"k";
  const total=aggregate(entries);
  const pending=total.pending>0;
  const net=pending?null:total.reward-total.cost;
  return {
    type,
    numbers,
    points,
    copy:`${type==="lo"?"L":"Đ"}: ${numbers} - ${points}${suffix}`,
    cost:total.cost,
    reward:total.reward,
    net,
    hits:total.hits,
    count:entries.length,
    pending
  };
}

function renderPredictionSummaryGroups(rows){
  return ["lo","de"].map(type=>{
    const group=rows.filter(row=>row.type===type);
    if(!group.length)return "";
    return `<div class="prediction-kind">
      <h4>${type==="lo"?"Lô":"Đề"}</h4>
      ${group.map(renderPredictionSummaryLine).join("")}
    </div>`;
  }).join("");
}

function renderPredictionSummaryLine(row){
  const money=row.pending?'<b class="pending">Chờ KQ</b>':`<b class="${row.net>=0?'positive':'negative'}">${row.net>=0?'+':''}${row.net}</b>`;
  return `<div class="prediction-line">
    <strong>${esc(row.copy)}</strong>
    <span>Đúng <b>${row.pending?"-":row.hits}</b></span>
    <span>Trừ <b class="negative">${row.cost}</b></span>
    <span>Cộng <b class="positive">${row.pending?"-":row.reward}</b></span>
    <span>Thành tiền ${money}</span>
  </div>`;
}

async function copyPredictionSummary(text){
  try{
    await navigator.clipboard.writeText(text);
    lastSaveMessage="Đã copy tổng hợp dự đoán.";
    updateStorageStatus();
  }catch{
    prompt("Copy tổng hợp dự đoán",text);
  }
}
window.copyPredictionSummary=copyPredictionSummary;

function renderLeaderboard(){
  const members=visibleMembers();
  const ranks=members.map(m=>{
    const a=aggregate(visibleEntries(state.entries).filter(e=>e.memberId===m.id));
    return {name:m.name,...a,net:a.reward-a.cost};
  }).sort((a,b)=>b.net-a.net);
  $("#leaderboard").innerHTML=ranks.length?ranks.map((r,i)=>`
    <div class="rank"><strong>#${i+1}</strong><div><strong>${esc(r.name)}</strong><br>
    <small>Điểm trừ ${r.cost} · Điểm cộng ${r.reward}${r.pending?` · ${r.pending} lượt chờ`:""}</small></div>
    <strong class="${r.net>=0?'positive':'negative'}">${r.net>=0?'+':''}${r.net}</strong></div>`).join(""):
    '<p class="muted">Chưa có dữ liệu.</p>';
}

function render(){
  enforceAdminOnlySubtabs();
  const activeTab=$(".tab.active")?.dataset.tab||"predict";
  const activeSubtab=$(".subtab.active")?.dataset.subtab||"results";
  if(activeTab==="predict"){
    renderMembers();
    renderQuickEntrySaved();
    refreshManualAnalysisIfOpen();
  }else if(activeTab==="stats"){
    if(activeSubtab==="results"){
      renderResultPreview();
      renderHeadStats();
      renderResultStats();
    }else if(activeSubtab==="special"){
      renderSpecialStats();
    }
  }else if(activeTab==="dbbridge"){
    renderDbBridgeStats();
  }else if(activeTab==="doublebridge"){
    renderLongTermDoubleBridge("#statsLongTermDoubleBridge","#doubleBridgeStatsWeekSelect");
  }else if(activeTab==="forecast"){
    deferRender(renderForecastStats,"#forecastStats");
  }else if(activeTab==="patterns"){
    deferRender(renderPatternStats,"#patternStats");
  }else if(activeTab==="report"){
    renderEntries();
    renderReport();
    renderLeaderboard();
  }
  updateStorageStatus();
  updateFloatScrollButton();
  renderAdminState();
}
initPersistentState();

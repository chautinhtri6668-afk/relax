const $=s=>document.querySelector(s);
const $$=s=>document.querySelectorAll(s);
const KEY="so-diem-vui-v2";
const DB_NAME="so-diem-vui-db";
const DB_STORE="data";
const CLOUD_URL_KEY="so-diem-vui-cloud-url";
const CLOUD_TOKEN_KEY="so-diem-vui-cloud-token";
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
const ADMIN_HASH="e6121f114d1b02a340a2f495504c92feb62a13590a161c25f282d1845aa600ad";

const uid=()=>crypto.randomUUID?crypto.randomUUID():String(Date.now()+Math.random());
const localDate=d=>{
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,"0");
  const day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
};
const today=()=>localDate(new Date());
const addDays=n=>{const d=new Date();d.setDate(d.getDate()+n);return localDate(d)};
const yesterday=()=>addDays(-1);
$("#resultDate").value=today(); $("#entryDate").value=today();
$("#referenceMode").value=localStorage.getItem(REFERENCE_MODE_KEY)||"fun";
$("#referenceBacktestMonth").value=localStorage.getItem(REFERENCE_MONTH_KEY)||today().slice(0,7);
$("#lawReferenceMode").value=localStorage.getItem(LAW_MODE_KEY)||"fun";
$("#lawBacktestMonth").value=localStorage.getItem(LAW_MONTH_KEY)||today().slice(0,7);

function normalizeState(data){
  const safe=data&&typeof data==="object"?data:{};
  const resultsByDate=new Map();
  (Array.isArray(safe.results)?safe.results:[]).forEach(({image,...r})=>{
    if(r?.date) resultsByDate.set(r.date,r);
  });
  return {
    members:Array.isArray(safe.members)?safe.members:[],
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
    url:localStorage.getItem(CLOUD_URL_KEY)||"",
    token:localStorage.getItem(CLOUD_TOKEN_KEY)||""
  };
}
function setCloudStatus(message,ok=true){
  const el=$("#cloudStatus");
  if(el){
    el.textContent=message;
    el.className=ok?"storage-status ok":"storage-status warn";
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
async function loadCloudState(){
  if(!requireAdmin())return;
  if(!saveCloudConfig())return;
  const cfg=cloudConfig();
  setCloudStatus("Đang tải dữ liệu cloud...");
  try{
    const res=await jsonp(cfg.url,{action:"load",token:cfg.token});
    if(!res?.ok)throw new Error(res?.error||"Cloud trả về lỗi");
    if(!res.data)throw new Error("Cloud chưa có dữ liệu");
    const incoming=normalizeState(res.data);
    const label=`Cloud${res.updatedAt?` cập nhật ${res.updatedAt}`:""}`;
    if(!shouldReplaceLocalWith(incoming,label))return;
    makeLocalBackup("before-load-cloud");
    state=incoming;
    save();
    setCloudStatus(`Đã tải cloud về máy này: ${stateStatsText(state)}.`);
  }catch(err){
    setCloudStatus(`Tải cloud lỗi: ${err.message||err}`,false);
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
    await fetch(cfg.url,{
      method:"POST",
      mode:"no-cors",
      headers:{"Content-Type":"text/plain;charset=utf-8"},
      body:JSON.stringify({action:"save",token:cfg.token,data:state})
    });
    setCloudStatus(`Đã gửi dữ liệu lên cloud: ${stateStatsText(state)}. Bấm Tải cloud ở máy khác để lấy về.`);
  }catch(err){
    setCloudStatus(`Lưu cloud lỗi: ${err.message||err}`,false);
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
function renderAdminState(){
  $$(".admin-only").forEach(el=>el.classList.toggle("admin-hidden",!isAdmin));
  $("#adminForm").classList.toggle("admin-hidden",isAdmin);
  if(isAdmin)fillCloudForm();
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
  if(!pointMatch)return null;
  const rawPoints=pointMatch[1].replace(",",".");
  const points=Number(rawPoints);
  if(!Number.isFinite(points)||points<=0)return null;
  const suffix=pointMatch[2]||"";
  const numberPart=text.slice(0,pointMatch.index);
  if(numberPart.includes("đầu")||numberPart.includes("dau")){
    const heads=(numberPart.match(/\d/g)||[]).filter((n,i,a)=>a.indexOf(n)===i);
    if(!heads.length)return null;
    const numbers=heads.flatMap(head=>Array.from({length:10},(_,tail)=>`${head}${tail}`));
    const type=suffix==="k"?"de":"de";
    const groupLabel=heads.map(head=>`${head}0 -> ${head}9`).join(", ");
    return {type,numbers,points,groupLabel};
  }
  const numbers=(numberPart.match(/\d{1,2}/g)||[]).map(two).filter((n,i,a)=>a.indexOf(n)===i);
  if(!numbers.length)return null;
  const type=suffix==="k"?"de":suffix==="đ"||suffix==="d"||suffix==="điểm"||suffix==="diem"?"lo":$("#entryType").value;
  return {type,numbers,points,groupLabel:""};
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
  let imported=0,updated=0,skipped=0;
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
    imported++;
    if(existing)updated++;
  });
  state.results=[...resultMap.values()];
  touchState();
  return {imported,updated,skipped};
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

function parseLotteryText(text){
  const date=parseOcrDate(text);
  const expected=[5,5,5,5,5,5,5,5,5,5,4,4,4,4,4,4,4,4,4,4,3,3,3,2,2,2,2];
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
  if(btn.dataset.subtab==="forecast")deferRender(renderForecastStats,"#forecastStats");
  else if(btn.dataset.subtab==="patterns")deferRender(renderPatternStats,"#patternStats");
  else render();
}));

$("#adminForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const ok=await sha256($("#adminPassword").value)===ADMIN_HASH;
  $("#adminPassword").value="";
  if(!ok){alert("Sai mật khẩu QTV.");return}
  isAdmin=true;
  sessionStorage.setItem("so-diem-vui-admin","1");
  render();
});
$("#adminLogout").addEventListener("click",()=>{
  isAdmin=false;
  sessionStorage.removeItem("so-diem-vui-admin");
  render();
});

$("#memberForm").addEventListener("submit",e=>{
  e.preventDefault(); const name=$("#memberName").value.trim(); if(!name)return;
  if(!requireAdmin())return;
  state.members.push({id:uid(),name}); $("#memberName").value=""; save();
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

$("#entryForm").addEventListener("submit",e=>{
  e.preventDefault();
  if(!state.members.length){alert("Hãy thêm thành viên trước.");return}
  state.entries.push({
    id:uid(),date:$("#entryDate").value,memberId:$("#entryMember").value,
    type:$("#entryType").value,number:two($("#entryNumber").value),
    points:Number($("#entryPoints").value)
  });
  $("#entryNumber").value=""; save();
});

$("#quickEntryBtn").addEventListener("click",()=>{
  if(!state.members.length){alert("Hãy thêm thành viên trước.");return}
  const date=$("#entryDate").value;
  const memberId=$("#entryMember").value;
  const lines=$("#quickEntryText").value.split(/\r?\n|;/).map(x=>x.trim()).filter(Boolean);
  if(!lines.length){
    $("#quickEntryStatus").textContent="Chưa có nội dung.";
    return;
  }
  let added=0;
  let addedPoints=0;
  const failed=[];
  lines.forEach(line=>{
    const parsed=parseQuickEntryLine(line);
    if(!parsed){failed.push(line);return}
    const batchId=parsed.groupLabel?uid():"";
    const batchLabel=parsed.groupLabel||"";
    parsed.numbers.forEach(number=>{
      state.entries.push({id:uid(),date,memberId,type:parsed.type,number,points:parsed.points,batchId,batchLabel});
      added++;
      addedPoints+=parsed.points;
    });
  });
  if(added){
    $("#quickEntryText").value="";
    save();
  }else render();
  $("#quickEntryStatus").textContent=failed.length?
    `Đã thêm ${added} lượt, tổng điểm ${addedPoints}, lỗi ${failed.length} dòng.`:
    `Đã thêm ${added} lượt, tổng điểm ${addedPoints}.`;
});

$("#entryType").addEventListener("change",()=>{
  $("#entryPoints").value=$("#entryType").value==="de"?10:1;
});
$("#filterDate").addEventListener("change",render);
$("#clearFilter").addEventListener("click",()=>{$("#filterDate").value="";render()});
$("#reportDate").addEventListener("change",render);
$("#clearReportDate").addEventListener("click",()=>{$("#reportDate").value="";render()});
$("#specialYear").addEventListener("change",renderSpecialStats);
$("#patternYear").addEventListener("change",()=>deferRender(renderForecastStats,"#forecastStats"));
$("#patternBaseDate").addEventListener("change",()=>deferRender(renderForecastStats,"#forecastStats"));
$("#lawYear").addEventListener("change",()=>deferRender(renderPatternStats,"#patternStats"));
$("#lawBaseDate").addEventListener("change",()=>deferRender(renderPatternStats,"#patternStats"));
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
  renderResultPreview();
  renderHeadStats();
});
$("#closeResultModal").addEventListener("click",closeResultModal);
$("#resultModal").addEventListener("click",e=>{if(e.target.id==="resultModal")closeResultModal()});
$("#saveCloudConfig").addEventListener("click",saveCloudConfig);
$("#loadCloudData").addEventListener("click",loadCloudState);
$("#saveCloudData").addEventListener("click",saveCloudState);
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

$("#exportBtn").addEventListener("click",()=>{
  if(!requireAdmin())return;
  downloadJson(state,`so-diem-vui-${today()}.json`);
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
    save();
    alert(`Đã import ${stats.imported} ngày. Ghi đè ${stats.updated} ngày trùng. Bỏ qua ${stats.skipped} dòng lỗi.`);
  }catch(err){
    alert(`Không tải được CSV. Kiểm tra mạng rồi thử lại.\n${err.message||err}`);
  }finally{
    btn.disabled=false;
    btn.textContent=oldText;
  }
});
$("#importFile").addEventListener("change",e=>{
  if(!requireAdmin()){e.target.value="";return}
  const f=e.target.files[0]; if(!f)return;
  const rd=new FileReader();
  rd.onload=()=>{
    try{
      const incoming=normalizeState(JSON.parse(rd.result));
      if(!shouldReplaceLocalWith(incoming,`File ${f.name}`))return;
      makeLocalBackup("before-import-file");
      state=incoming;
      save();
      alert(`Đã nhập file: ${stateStatsText(state)}.`);
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
  if(calcResult.hits)return `${calcResult.hits} lần (${calcResult.matches.map(esc).join(", ")})`;
  return `0 lần - không thấy ${entry.number}`;
}

function removeMember(id){
  if(!requireAdmin())return;
  if(!confirm("Xóa thành viên và các lượt liên quan?"))return;
  state.members=state.members.filter(x=>x.id!==id);
  state.entries=state.entries.filter(x=>x.memberId!==id);save()
}
function editMember(id){
  if(!requireAdmin())return;
  const member=state.members.find(x=>x.id===id);
  if(!member)return;
  const name=prompt("Tên mới",member.name);
  if(!name||!name.trim())return;
  member.name=name.trim();
  save();
}
function removeEntry(id){state.entries=state.entries.filter(x=>x.id!==id);save()}
function removeEntries(ids){
  const set=new Set(String(ids).split(","));
  state.entries=state.entries.filter(x=>!set.has(x.id));save();
}
function removeEntriesByDate(date){
  if(!confirm(`Xóa toàn bộ lượt dự đoán ngày ${displayDate(date)}?`))return;
  state.entries=state.entries.filter(x=>x.date!==date);save();
}
window.removeMember=removeMember; window.editMember=editMember; window.removeEntry=removeEntry; window.removeEntries=removeEntries; window.removeEntriesByDate=removeEntriesByDate;

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
    sorted.find(r=>r.date===yesterday())||
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
  $("#memberList").innerHTML=state.members.length?state.members.map(m=>`
    <div class="member"><strong>${esc(m.name)}</strong>
    <span class="member-actions admin-only">
      <button class="secondary" type="button" onclick="editMember('${m.id}')">Sửa</button>
      <button class="danger" type="button" onclick="removeMember('${m.id}')">Xóa</button>
    </span></div>`).join(""):
    '<p class="muted">Chưa có thành viên.</p>';
  $("#entryMember").innerHTML=state.members.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join("");
}

function renderEntries(){
  const filter=$("#filterDate").value;
  const entries=[...state.entries].filter(x=>!filter||x.date===filter).sort((a,b)=>b.date.localeCompare(a.date));
  if(!entries.length){
    $("#summaryBody").innerHTML='<tr><td colspan="9" class="muted">Chưa có lượt nào.</td></tr>';
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
          <td><button class="danger" onclick="event.stopPropagation();removeEntry('${e.id}')">Xóa</button></td>
        </tr>`;
      }).join("")}</tbody>
    </table>
  </div>`;
}

function buildEntryDetailRows(entries){
  const rows=[];
  const used=new Set();
  entries.forEach(entry=>{
    if(used.has(entry.id))return;
    if(entry.batchId){
      const group=entries.filter(x=>x.batchId===entry.batchId);
      group.forEach(x=>used.add(x.id));
      rows.push({kind:"group",entries:group});
      return;
    }
    used.add(entry.id);
    rows.push({kind:"single",entries:[entry]});
  });
  return rows;
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
  const hitText=pending?"-":first.type==="de"?
    `${hits} con trúng${matches.length?` (${matches.map(esc).join(", ")})`:""}`:
    `${hits} lần${matches.length?` (${matches.map(esc).join(", ")})`:""}`;
  const ids=entries.map(e=>e.id).join(",");
  const totalPoints=entries.reduce((sum,e)=>sum+e.points,0);
  const numbers=first.batchLabel||groupNumbersLabel(entries);
  return `<tr>
    <td>${esc(memberName(first.memberId))}</td>
    <td>${first.type==="lo"?"Lô":"Đề"}</td>
    <td><strong>${esc(numbers)}</strong></td>
    <td>${totalPoints}</td>
    <td>${hitText}</td>
    <td>${cost}</td>
    <td>${pending?"-":reward}</td>
    <td>${status}</td>
    <td><button class="danger" onclick="event.stopPropagation();removeEntries('${ids}')">Xóa</button></td>
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

function renderResultPreview(tempImage){
  const sorted=stateCache.resultsDesc;
  const selectedDate=$("#resultSelect").value;
  $("#resultSelect").innerHTML=sorted.length?sorted.map(r=>`<option value="${r.date}">${displayDate(r.date)}</option>`).join(""):'<option>Chưa có kết quả</option>';
  if(sorted.some(r=>r.date===selectedDate)) $("#resultSelect").value=selectedDate;
  else if(sorted.some(r=>r.date===yesterday())) $("#resultSelect").value=yesterday();
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
}
window.showResultModal=showResultModal;

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
  const all=aggregate(state.entries);
  const dates=stateCache.resultsDesc.map(r=>r.date);
  $("#resultStats").innerHTML=`
    <div class="stat-grid">
      <div class="stat-card">Ngày có kết quả<strong>${state.results.length}</strong></div>
      <div class="stat-card">Lượt đã nhập<strong>${state.entries.length}</strong></div>
      <div class="stat-card">Lượt chờ chấm<strong>${all.pending}</strong></div>
    </div>
    <div class="result-list">
      ${dates.length?dates.map(date=>{
        const r=resultForDate(date);
        const dayEntries=state.entries.filter(e=>e.date===date);
        const a=aggregate(dayEntries);
        return `<div class="result-item">
          <div><strong>${displayDate(date)}</strong><br><small>ĐB ${esc(r.special)} · ${r.prizes.length} giải · ${dayEntries.length} lượt</small></div>
          <span class="pill">${a.hits} lần trúng</span>
        </div>`;
      }).join(""):'<p class="muted">Chưa có kết quả đã lưu.</p>'}
    </div>`;
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

function addDate(date,days){
  const d=new Date(`${date}T00:00:00`);
  d.setDate(d.getDate()+days);
  return localDate(d);
}

function reverse2(number){
  return String(number).padStart(2,"0").split("").reverse().join("");
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

function renderReferenceNumbers(loPicks,dbPicks,allocation){
  if(!loPicks.length&&!dbPicks.length&&!allocation.pool?.length&&!allocation.monthly)return "";
  return `<div class="reference-box">
    <div class="reference-head">
      <h3>Phân bổ điểm tham khảo</h3>
      <small>${allocation.mode} · mục tiêu ${allocation.target} · đang trừ ${allocation.totalCost}</small>
    </div>
    ${renderReferenceSignal(allocation.signal)}
    ${renderReferencePool(allocation.pool)}
    ${renderReferencePerformance(allocation.performance)}
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

function renderReferenceGroup(title,picks,type){
  const text=referenceCopyText(picks,type);
  const cost=referenceCost(picks,type);
  const top=picks[0];
  const bestNet=top?top.stake*80-cost:0;
  return `<div class="reference-group">
    <div class="reference-title">
      <strong>${title}</strong>
      ${picks.length?`<button class="secondary" type="button" data-text="${esc(text)}" onclick="copyReferenceText(this.dataset.text)">Copy</button>`:""}
    </div>
    <div class="reference-metrics">
      <span>${type==="lo"?"Điểm trừ tối đa":"Vốn đề"}: <strong>${cost}</strong></span>
      ${top?`<span>Trúng top 1: <strong class="${bestNet>=0?'positive':'negative'}">${bestNet>=0?'+':''}${bestNet}</strong></span>`:""}
    </div>
    <div class="reference-numbers ${type}">${picks.length?picks.map(p=>`
      <span title="Tỷ lệ tốt nhất ${Math.round(p.bestRate*100)}%, xuất hiện trong ${p.count} rule">
        ${p.number}<small>${p.stake}${type==="de"?"k":"đ"}</small>
      </span>`).join(""):'<em>Chưa đủ dữ liệu</em>'}</div>
    ${picks.length?`<small>${esc(text).replace(/\n/g,"<br>")}</small>`:""}
  </div>`;
}

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
  const filter=$("#reportDate").value;
  const entries=state.entries.filter(e=>!filter||e.date===filter);
  const total=aggregate(entries);
  const net=total.reward-total.cost;
  const byMember=state.members.map(m=>{
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
}

function renderLeaderboard(){
  const ranks=state.members.map(m=>{
    const a=aggregate(state.entries.filter(e=>e.memberId===m.id));
    return {name:m.name,...a,net:a.reward-a.cost};
  }).sort((a,b)=>b.net-a.net);
  $("#leaderboard").innerHTML=ranks.length?ranks.map((r,i)=>`
    <div class="rank"><strong>#${i+1}</strong><div><strong>${esc(r.name)}</strong><br>
    <small>Điểm trừ ${r.cost} · Điểm cộng ${r.reward}${r.pending?` · ${r.pending} lượt chờ`:""}</small></div>
    <strong class="${r.net>=0?'positive':'negative'}">${r.net>=0?'+':''}${r.net}</strong></div>`).join(""):
    '<p class="muted">Chưa có dữ liệu.</p>';
}

function render(){
  const activeTab=$(".tab.active")?.dataset.tab||"predict";
  const activeSubtab=$(".subtab.active")?.dataset.subtab||"results";
  if(activeTab==="predict"){
    renderMembers();
    renderEntries();
  }else if(activeTab==="stats"){
    if(activeSubtab==="results"){
      renderResultPreview();
      renderHeadStats();
      renderResultStats();
    }else if(activeSubtab==="special"){
      renderSpecialStats();
    }else if(activeSubtab==="forecast"){
      deferRender(renderForecastStats,"#forecastStats");
    }else if(activeSubtab==="patterns"){
      deferRender(renderPatternStats,"#patternStats");
    }
  }else if(activeTab==="report"){
    renderReport();
    renderLeaderboard();
  }
  updateStorageStatus();
  renderAdminState();
}
initPersistentState();


import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const CLOUD_DOCUMENT = "state_clean_20261019_v1"; // Base exclusiva nueva. No lee ni modifica documentos anteriores.
let gameColors = {};
const firebaseEnabled = Boolean(firebaseConfig?.apiKey);
const firebaseApp = firebaseEnabled ? initializeApp(firebaseConfig) : null;
const db = firebaseEnabled ? getFirestore(firebaseApp) : null;
const cloudDocRef = firebaseEnabled ? doc(db, "app", CLOUD_DOCUMENT) : null;
let syncingFromCloud = false;

const PALETTE = {
  blue: "#3DB1F5",
  red: "#DD4936",
  yellow: "#FCC436",
  green: "#12BA69",
  light: "#F2F2F2",
  dark: "#263238",
  ink: "#18212B"
};

const PLAYER_COLORS = {
  MANU: PALETTE.blue,
  SOFI: PALETTE.red
};

const DEFAULT_GAME_COLORS = [
  "#12BA69", "#FCC436", "#3DB1F5", "#DD4936",
  "#20C997", "#FFB703", "#4895EF", "#F94144",
  "#90BE6D", "#F3722C", "#43AA8B", "#577590",
  "#8ECAE6", "#219EBC", "#023047", "#FB8500",
  "#B8F2E6", "#AED9E0", "#FFA69E", "#5E6472"
];

let state = {games:["Escoba","Burako","10.000","Azul"],locations:["Casa Sofi","Casa Manu","Casita🏠","Otro"],matches:[]};
let activeModalType = null;
let activeGameDetail = null;
let chartResizeTimer = null;

const $ = (id) => document.getElementById(id);

let cloudReady = false;
let cloudRevision = 0;
let lastCloudMatches = [];
let pendingSave = Promise.resolve();
function status(text){ if($("saveStatus")) $("saveStatus").textContent = text; }
async function saveState(){
  if(!firebaseEnabled || !cloudReady){ status("Sin conexión · no se guardó"); alert("No hay conexión con Firebase. No se puede guardar esta partida."); return; }
  const copy = structuredClone(state);
  const revision = ++cloudRevision;
  pendingSave = pendingSave.catch(()=>{}).then(async()=>{
    status("Guardando en nube...");
    const saved = await runTransaction(db, async transaction => {
      const snap = await transaction.get(cloudDocRef);
      if(!snap.exists()) throw Error("La nube todavía no está inicializada");
      const remote = snap.data();
      const remoteMatches = remote.matches || [];
      const previousIds = new Set(lastCloudMatches.map(m=>String(m.id)));
      const localIds = new Set(copy.matches.map(m=>String(m.id)));
      const deletedIds = new Set([...previousIds].filter(id=>!localIds.has(id)));
      const combined = new Map(remoteMatches.filter(m=>!deletedIds.has(String(m.id))).map(m=>[String(m.id),m]));
      for(const m of copy.matches){
        const id=String(m.id);
        if(!previousIds.has(id) || JSON.stringify(m)!==JSON.stringify(lastCloudMatches.find(x=>String(x.id)===id))) combined.set(id,m);
      }
      const merged={
        games:[...new Set([...(remote.games||[]),...(copy.games||[])])],
        locations:[...new Set([...(remote.locations||[]),...(copy.locations||[])])],
        matches:[...combined.values()],updatedAt:new Date().toISOString()
      };
      transaction.set(cloudDocRef,merged);
      return merged;
    });
    lastCloudMatches=structuredClone(saved.matches);
    if(revision===cloudRevision) status("Sincronizado en nube");
  }).catch(err=>{console.error(err);status("Error al guardar en nube · revisá la conexión"); alert("No se pudo guardar en Firebase. No cierres la página: revisá la conexión y volvé a intentar.");});
  return pendingSave;
}
function downloadBackup(){
  const blob = new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob), link=document.createElement("a");
  link.href=url;link.download=`ludopatia-respaldo-${new Date().toISOString().slice(0,10)}.json`;
  link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function matchKey(m){
  return [m.fecha,String(m.juego||"").trim().toLowerCase(),String(m.lugar||"").trim().toLowerCase(),Number(m.puntajeSofi),Number(m.puntajeManu)].join("|");
}
function mergeHistories(base,incoming){
  const result=structuredClone(base);
  result.games=[...new Set([...(base.games||[]),...(incoming.games||[])])];
  result.locations=[...new Set([...(base.locations||[]),...(incoming.locations||[])])];
  const count=new Map();
  for(const m of result.matches){const k=matchKey(m);count.set(k,(count.get(k)||0)+1);}
  const seen=new Map();let added=0;
  for(const m of incoming.matches){
    const k=matchKey(m),n=(seen.get(k)||0)+1;seen.set(k,n);
    if(n>(count.get(k)||0)){
      result.matches.push({...m,id:uid(),ganador:Number(m.puntajeManu)>Number(m.puntajeSofi)?"MANU":"SOFI"});
      added++;count.set(k,(count.get(k)||0)+1);
    }
  }
  return {result,added};
}
async function importBackup(file){
  if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(!Array.isArray(data.matches)||!Array.isArray(data.games)||!Array.isArray(data.locations))throw Error("Formato de respaldo inválido");
    const {result,added}=mergeHistories(state,data);
    if(!confirm(`Se agregarán ${added} partidas únicas de ${data.matches.length} registros del archivo. Las coincidencias exactas se conservarán una sola vez entre historiales, respetando repeticiones dentro de cada historial. ¿Continuar?`))return;
    downloadBackup();state=result;await saveState();render();
    alert(`Importación terminada: ${added} partidas agregadas. Se descargó una copia de seguridad previa.`);
  }catch(err){alert("No se pudo importar: "+err.message);}
}

function normalizeName(value){
  return String(value || "").trim().replace(/\s+/g," ").replace(/\b\w/g, c => c.toUpperCase());
}

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
}

function formatDate(value){
  if(!value) return "";
  const [y,m,d] = String(value).slice(0,10).split("-");
  if(!y || !m || !d) return value;
  return `${d}/${m}/${String(y).slice(-2)}`;
}

function monthLabel(value){
  if(!value) return "";
  const [y,m] = String(value).slice(0,7).split("-");
  if(!y || !m) return value;
  return `${m}/${String(y).slice(-2)}`;
}

function dateBucketList(list = state.matches){
  const uniqueMonths = new Set(list.map(p => String(p.fecha).slice(0,7))).size;
  const uniqueDates = new Set(list.map(p => String(p.fecha).slice(0,10))).size;
  const useMonths = uniqueDates > 10 || uniqueMonths > 4;
  const out = {};
  list.forEach(p=>{
    const key = useMonths ? String(p.fecha).slice(0,7) : String(p.fecha).slice(0,10);
    const label = useMonths ? monthLabel(p.fecha) : formatDate(p.fecha);
    out[key] ??= {label, SOFI:0, MANU:0, raw:key};
    out[key][p.ganador] = (out[key][p.ganador] || 0) + 1;
  });
  return Object.values(out).sort((a,b)=>String(a.raw).localeCompare(String(b.raw)));
}

function uid(){
  return crypto?.randomUUID ? crypto.randomUUID() : "id_" + Date.now() + "_" + Math.random().toString(16).slice(2);
}

function gameColorMap(){
  const saved = gameColors;
  state.games.forEach((game, index) => {
    if(!saved[game]){
      const used = Object.values(saved);
      saved[game] = DEFAULT_GAME_COLORS.find(c => !used.includes(c)) || DEFAULT_GAME_COLORS[index % DEFAULT_GAME_COLORS.length];
    }
  });

  return saved;
}

function setGameColor(game, color){
  const map = gameColorMap();
  map[game] = color;
  gameColors = map;
}

function gameColor(game){
  return gameColorMap()[game] || DEFAULT_GAME_COLORS[0];
}

function matches(){
  return [...state.matches].sort((a,b)=> String(b.fecha).localeCompare(String(a.fecha)) || String(b.id).localeCompare(String(a.id)));
}

function stats(list = state.matches){
  const total = list.length;
  const manu = list.filter(p=>p.ganador==="MANU").length;
  const sofi = list.filter(p=>p.ganador==="SOFI").length;
  return {
    total, manu, sofi,
    pctManu: total ? Math.round(manu/total*100) : 0,
    pctSofi: total ? Math.round(sofi/total*100) : 0
  };
}

function render(){
  gameColorMap();
  renderSelectors();
  renderEditSelectors();
  renderScoreboard();
  renderHistory();
  renderGameDetailButtons();
  if(!$("detailsPage").classList.contains("hidden")) renderCharts();
}

function renderSelectors(){
  const currentGame = $("juego").value;
  const currentLocation = $("lugar").value;
  $("juego").innerHTML = state.games.map(g=>`<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("") + `<option value="__nuevo_juego__">+ Cargar juego nuevo</option>`;
  $("lugar").innerHTML = state.locations.map(l=>`<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join("") + `<option value="__nueva_locacion__">+ Cargar locación nueva</option>`;
  if(state.games.includes(currentGame)) $("juego").value = currentGame;
  if(state.locations.includes(currentLocation)) $("lugar").value = currentLocation;
  if(!$("fecha").value) $("fecha").valueAsDate = new Date();
}


function renderEditSelectors(){
  if(!$("editJuego") || !$("editLugar")) return;
  $("editJuego").innerHTML = state.games.map(g=>`<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("");
  $("editLugar").innerHTML = state.locations.map(l=>`<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join("");
}

function renderScoreboard(){
  const s = stats();
  $("scoreboard").innerHTML = `
    <div class="total-card total-main">
      <span>Partidas totales</span>
      <strong>${s.total}</strong>
    </div>

    <div class="player-card sofi-card" style="--player-color:${PLAYER_COLORS.SOFI}">
      <span>Ganadas por Sofi</span>
      <strong>${s.sofi}</strong>
      <small>${s.pctSofi}% del total</small>
      <div class="mini-bar"><i style="width:${s.pctSofi}%;background:${PLAYER_COLORS.SOFI}"></i></div>
    </div>

    <div class="player-card manu-card" style="--player-color:${PLAYER_COLORS.MANU}">
      <span>Ganadas por Manu</span>
      <strong>${s.manu}</strong>
      <small>${s.pctManu}% del total</small>
      <div class="mini-bar"><i style="width:${s.pctManu}%;background:${PLAYER_COLORS.MANU}"></i></div>
    </div>
  `;
}

function renderHistory(){
  const filtered = matches();
  $("history").innerHTML = filtered.map(p=>`
    <tr>
      <td>${formatDate(p.fecha)}</td>
      <td><span class="game-badge" style="--game-color:${gameColor(p.juego)}">${escapeHtml(p.juego)}</span></td>
      <td>${escapeHtml(p.lugar)}</td>
      <td class="score sofi-score">${Number(p.puntajeSofi)}</td>
      <td class="score manu-score">${Number(p.puntajeManu)}</td>
      <td><button class="edit-mini" data-edit-match="${p.id}" title="Editar partida">✏️</button></td>
    </tr>`).join("") || `<tr><td colspan="6" class="empty">No hay partidas para mostrar.</td></tr>`;
}

function renderGameDetailButtons(){
  const el = $("gameDetailButtons");
  if(!el) return;
  el.innerHTML = state.games.map(g=>`
    <button class="game-detail-btn" data-open-game="${escapeHtml(g)}" style="--game-color:${gameColor(g)}">
      ${escapeHtml(g)}
    </button>
  `).join("");
}

function addMatch(e){
  e.preventDefault();
  const sofi = Number($("puntajeSofi").value);
  const manu = Number($("puntajeManu").value);
  const item = {
    id: uid(),
    fecha: $("fecha").value,
    juego: $("juego").value,
    lugar: $("lugar").value,
    puntajeSofi: sofi,
    puntajeManu: manu,
    ganador: manu > sofi ? "MANU" : "SOFI",
    observaciones: ""
  };
  if(item.juego.startsWith("__") || item.lugar.startsWith("__")) return;
  state.matches.push(item);
  saveState();
  $("puntajeSofi").value = "";
  $("puntajeManu").value = "";
  render();
}

function groupCount(key, list = state.matches){
  const out = {};
  list.forEach(p => out[p[key]] = (out[p[key]] || 0) + 1);
  return out;
}

function groupWinsBy(key, list = state.matches){
  const out = {};
  list.forEach(p=>{
    out[p[key]] ??= {label:p[key], SOFI:0, MANU:0};
    out[p[key]][p.ganador] = (out[p[key]][p.ganador] || 0) + 1;
  });
  return Object.values(out);
}

function groupByDate(list = state.matches){
  return dateBucketList(list);
}

function pointsByPlayer(list){
  return [
    {label:"Sofi", value:list.reduce((a,p)=>a+Number(p.puntajeSofi||0),0), color:PLAYER_COLORS.SOFI},
    {label:"Manu", value:list.reduce((a,p)=>a+Number(p.puntajeManu||0),0), color:PLAYER_COLORS.MANU}
  ];
}

/* ---------- Modal alta/configuración ---------- */

function openModal(type){
  activeModalType = type;
  const isGame = type === "game";
  $("modalOverlay").classList.remove("hidden");
  $("modalTitle").textContent = isGame ? "Cargar juego nuevo" : "Cargar locación nueva";
  $("modalEyebrow").textContent = isGame ? "Juegos" : "Locaciones";
  $("modalNameLabel").firstChild.textContent = isGame ? "Nombre del juego" : "Nombre de la locación";
  $("modalName").placeholder = isGame ? "Ej: Catán" : "Ej: Casa de amigos";
  $("modalColorLabel").classList.toggle("hidden", !isGame);
  $("modalColor").value = nextAvailableGameColor();
  $("modalName").value = "";
  $("modalSettingsArea").classList.add("hidden");
  renderModalList();
  setTimeout(()=>$("modalName").focus(), 50);
}

function closeModal(){
  $("modalOverlay").classList.add("hidden");
  activeModalType = null;
  if($("juego").value === "__nuevo_juego__") $("juego").value = state.games[0] || "";
  if($("lugar").value === "__nueva_locacion__") $("lugar").value = state.locations[0] || "";
}

function nextAvailableGameColor(){
  const used = Object.values(gameColorMap());
  return DEFAULT_GAME_COLORS.find(c => !used.includes(c)) || DEFAULT_GAME_COLORS[0];
}

function saveFromModal(){
  const name = normalizeName($("modalName").value);
  if(!name) return alert("Escribí un nombre.");
  if(activeModalType === "game"){
    if(!state.games.includes(name)) state.games.push(name);
    setGameColor(name, $("modalColor").value);
    saveState();
    render();
    $("juego").value = name;
  }
  if(activeModalType === "location"){
    if(!state.locations.includes(name)) state.locations.push(name);
    saveState();
    render();
    $("lugar").value = name;
  }
  closeModal();
}

function renderModalList(){
  if(activeModalType === "game"){
    $("modalSettingsTitle").textContent = "Juegos cargados";
    $("modalList").innerHTML = state.games.map(g=>`
      <div class="config-item">
        <input class="config-name" data-old-game="${escapeHtml(g)}" value="${escapeHtml(g)}">
        <input type="color" class="config-color" data-color-game="${escapeHtml(g)}" value="${gameColor(g)}">
        <button class="danger" data-delete-game="${escapeHtml(g)}">Borrar</button>
      </div>
    `).join("");
  } else {
    $("modalSettingsTitle").textContent = "Locaciones cargadas";
    $("modalList").innerHTML = state.locations.map(l=>`
      <div class="config-item">
        <input class="config-name" data-old-location="${escapeHtml(l)}" value="${escapeHtml(l)}">
        <button class="danger" data-delete-location="${escapeHtml(l)}">Borrar</button>
      </div>
    `).join("");
  }
}

function renameGame(oldName, newName){
  newName = normalizeName(newName);
  if(!newName || oldName === newName) return;
  if(state.games.includes(newName)) return alert("Ya existe un juego con ese nombre.");
  state.games = state.games.map(g => g === oldName ? newName : g);
  state.matches.forEach(m => { if(m.juego === oldName) m.juego = newName; });
  const map = gameColorMap();
  map[newName] = map[oldName] || nextAvailableGameColor();
  delete map[oldName];
  gameColors = map;
  saveState(); render(); renderModalList();
}

function renameLocation(oldName, newName){
  newName = normalizeName(newName);
  if(!newName || oldName === newName) return;
  if(state.locations.includes(newName)) return alert("Ya existe una locación con ese nombre.");
  state.locations = state.locations.map(l => l === oldName ? newName : l);
  state.matches.forEach(m => { if(m.lugar === oldName) m.lugar = newName; });
  saveState(); render(); renderModalList();
}

/* ---------- Detalle por juego ---------- */

function openGameDetail(game){
  activeGameDetail = game;
  $("gameDetailOverlay").classList.remove("hidden");
  $("gameDetailTitle").innerHTML = `<span class="game-title-dot" style="--game-color:${gameColor(game)}"></span>${escapeHtml(game)}`;
  renderGameDetail();
}

function closeGameDetail(){
  $("gameDetailOverlay").classList.add("hidden");
  activeGameDetail = null;
}

function renderGameDetail(){
  if(!activeGameDetail) return;
  const list = state.matches.filter(p=>p.juego === activeGameDetail);
  const s = stats(list);
  const sofiPoints = list.reduce((a,p)=>a+Number(p.puntajeSofi||0),0);
  const manuPoints = list.reduce((a,p)=>a+Number(p.puntajeManu||0),0);

  $("gameDetailSummary").innerHTML = `
    <div class="detail-kpi"><span>Partidas jugadas</span><strong>${s.total}</strong></div>
    <div class="detail-kpi sofi-detail"><span>Ganadas Sofi</span><strong>${s.sofi}</strong><small>${s.pctSofi}%</small></div>
    <div class="detail-kpi manu-detail"><span>Ganadas Manu</span><strong>${s.manu}</strong><small>${s.pctManu}%</small></div>
    <div class="detail-kpi"><span>Puntos Sofi / Manu</span><strong><b class="sofi-score">${sofiPoints}</b> / <b class="manu-score">${manuPoints}</b></strong></div>
  `;

  drawBar("detailWinsChart", [
    {label:"Sofi", value:s.sofi, color:PLAYER_COLORS.SOFI},
    {label:"Manu", value:s.manu, color:PLAYER_COLORS.MANU}
  ]);
  drawBar("detailPointsChart", pointsByPlayer(list));
  drawGroupedBar("detailLocationChart", groupWinsBy("lugar", list), false, false);
  drawGroupedBar("detailDateChart", groupByDate(list), false, true);
}

/* ---------- Gráficos Canvas ---------- */

function renderCharts(){
  drawGroupedBar("generalWinsByGameChart", groupWinsBy("juego"), true, false);
  drawGroupedBar("generalWinsByLocationChart", groupWinsBy("lugar"), false, false);
  drawGroupedBar("generalWinsByDateChart", groupByDate(), false, true);
}

function setupCanvas(id){
  const c = $(id);
  if(!c) return null;
  const dpr = window.devicePixelRatio || 1;
  const rect = c.getBoundingClientRect();
  const width = Math.max(300, rect.width || 300);
  const height = window.innerWidth <= 760 ? 360 : 340;
  c.width = width * dpr;
  c.height = height * dpr;
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,width,height);
  return {ctx,w:width,h:height};
}

function drawBar(id, data){
  const setup = setupCanvas(id); if(!setup) return;
  const {ctx,w,h} = setup;
  const pad = 48;
  const max = Math.max(1, ...data.map(d=>d.value));
  const bw = (w - pad*2) / Math.max(1, data.length);
  drawChartGrid(ctx,w,h,pad,max);
  data.forEach((d,i)=>{
    const bh = (h-100) * (d.value/max);
    const x = pad + i*bw + bw*.18;
    const y = h - 52 - bh;
    ctx.fillStyle = d.color || PALETTE.green;
    roundRect(ctx,x,y,bw*.64,Math.max(2,bh),12); ctx.fill();
    ctx.fillStyle = PALETTE.ink; ctx.font = "bold 13px Arial"; ctx.textAlign = "center";
    ctx.fillText(d.value, x + bw*.32, y - 8);
    ctx.fillStyle = "#66727d"; ctx.font = "12px Arial";
    ctx.fillText(trim(d.label, 15), x + bw*.32, h - 18);
  });
}

function drawGroupedBar(id, data, useGameBackground=false, verticalLabels=false){
  const setup = setupCanvas(id); if(!setup) return;
  const {ctx,w,h} = setup;
  const isMobile = window.innerWidth <= 760;
  const pad=48;
  const labelSpace = verticalLabels ? (isMobile ? 78 : 92) : 56;
  const max=Math.max(1,...data.flatMap(d=>[d.SOFI,d.MANU]));
  const bw=(w-pad*2)/Math.max(1,data.length);
  const chartHeight = h - labelSpace - 42;
  drawChartGrid(ctx,w,h,pad,max,labelSpace);

  data.forEach((d,i)=>{
    const groupX = pad+i*bw;
    const x0=groupX+bw*.18, base=h-labelSpace, ww=Math.max(8,bw*.22);

    if(useGameBackground){
      ctx.fillStyle = gameColor(d.label);
      roundRect(ctx, groupX + bw*.04, base + 12, bw*.92, 30, 14);
      ctx.fill();
      ctx.fillStyle = "#18212B";
      ctx.font = "bold 11px Arial";
      ctx.textAlign = "center";
      ctx.fillText(trim(d.label, 12), groupX + bw*.5, base + 32);
    }else{
      ctx.fillStyle="#66727d";
      ctx.font="12px Arial";
      ctx.textAlign="center";
      if(verticalLabels){
        ctx.save();
        ctx.translate(groupX + bw*.42, base + 18);
        ctx.rotate(-Math.PI/2);
        ctx.fillText(trim(d.label, 12), 0, 0);
        ctx.restore();
      }else{
        ctx.fillText(trim(d.label,12), groupX+bw*.42, h-18);
      }
    }

    [["SOFI",PLAYER_COLORS.SOFI],["MANU",PLAYER_COLORS.MANU]].forEach(([k,color],j)=>{
      const val=d[k]||0;
      const bh=chartHeight*(val/max);
      ctx.fillStyle=color; roundRect(ctx,x0+j*ww*1.32,base-bh,ww,Math.max(2,bh),8); ctx.fill();
      if(bw > 58){
        ctx.fillStyle=PALETTE.ink; ctx.font="bold 11px Arial"; ctx.textAlign="center";
        ctx.fillText(val,x0+j*ww*1.32+ww/2,base-bh-5);
      }
    });
  });
  drawLegend(ctx, [["Sofi",PLAYER_COLORS.SOFI],["Manu",PLAYER_COLORS.MANU]], 48, 20);
}
function drawChartGrid(ctx,w,h,pad,max,labelSpace=56){
  ctx.strokeStyle="rgba(24,33,43,.08)";
  ctx.lineWidth=1;
  ctx.font="11px Arial";
  ctx.fillStyle="#8a939b";
  ctx.textAlign="right";
  for(let i=0;i<=4;i++){
    const y = h-labelSpace - i*((h-labelSpace-42)/4);
    ctx.beginPath(); ctx.moveTo(pad,y); ctx.lineTo(w-pad,y); ctx.stroke();
    ctx.fillText(Math.round(max*i/4), pad-8, y+4);
  }
}

function drawLegend(ctx, items, x, y){
  ctx.font = "bold 12px Arial";
  ctx.textAlign = "left";
  items.forEach(([label,color], i)=>{
    const xx = x + i*86;
    ctx.fillStyle=color; roundRect(ctx,xx,y-9,14,14,4); ctx.fill();
    ctx.fillStyle="#66727d"; ctx.fillText(label, xx+20, y+3);
  });
}

function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

function trim(s,n){ s=String(s); return s.length>n?s.slice(0,n-1)+"…":s; }


/* ---------- Edición de partidas ---------- */

function openEditMatch(id){
  const m = state.matches.find(p => p.id === id);
  if(!m) return;
  renderEditSelectors();
  $("editMatchId").value = m.id;
  $("editFecha").value = m.fecha;
  $("editJuego").value = m.juego;
  $("editLugar").value = m.lugar;
  $("editPuntajeSofi").value = m.puntajeSofi;
  $("editPuntajeManu").value = m.puntajeManu;
  $("editMatchOverlay").classList.remove("hidden");
}

function closeEditMatch(){
  $("editMatchOverlay").classList.add("hidden");
}

function saveEditedMatch(e){
  e.preventDefault();
  const id = $("editMatchId").value;
  const m = state.matches.find(p => p.id === id);
  if(!m) return;

  const sofi = Number($("editPuntajeSofi").value);
  const manu = Number($("editPuntajeManu").value);

  m.fecha = $("editFecha").value;
  m.juego = $("editJuego").value;
  m.lugar = $("editLugar").value;
  m.puntajeSofi = sofi;
  m.puntajeManu = manu;
  m.ganador = manu > sofi ? "MANU" : "SOFI";

  saveState();
  closeEditMatch();
  render();
}

function deleteEditedMatch(){
  const id = $("editMatchId").value;
  if(!id) return;
  if(confirm("¿Eliminar esta partida?")){
    state.matches = state.matches.filter(p => p.id !== id);
    saveState();
    closeEditMatch();
    render();
  }
}

/* ---------- Eventos ---------- */

$("matchForm").addEventListener("submit", addMatch);

$("juego").addEventListener("change", () => {
  if($("juego").value === "__nuevo_juego__") openModal("game");
});

$("lugar").addEventListener("change", () => {
  if($("lugar").value === "__nueva_locacion__") openModal("location");
});

$("detailsBtn").addEventListener("click", () => {
  $("homePage").classList.add("hidden");
  $("detailsPage").classList.remove("hidden");
  setTimeout(renderCharts, 60);
});

$("detailsBtnTop").addEventListener("click", () => {
  $("homePage").classList.add("hidden");
  $("detailsPage").classList.remove("hidden");
  setTimeout(renderCharts, 60);
});

$("homeBtn").addEventListener("click", () => {
  $("detailsPage").classList.add("hidden");
  $("homePage").classList.remove("hidden");
});

$("backBtn").addEventListener("click", () => {
  $("detailsPage").classList.add("hidden");
  $("homePage").classList.remove("hidden");
});

$("modalClose").addEventListener("click", closeModal);
$("modalOverlay").addEventListener("click", e => { if(e.target.id === "modalOverlay") closeModal(); });
$("modalSave").addEventListener("click", saveFromModal);
$("modalSettingsBtn").addEventListener("click", () => {
  $("modalSettingsArea").classList.toggle("hidden");
  renderModalList();
});

$("modalList").addEventListener("change", (e)=>{
  if(e.target.dataset.oldGame) renameGame(e.target.dataset.oldGame, e.target.value);
  if(e.target.dataset.oldLocation) renameLocation(e.target.dataset.oldLocation, e.target.value);
  if(e.target.dataset.colorGame){
    setGameColor(e.target.dataset.colorGame, e.target.value);
    render();
    renderModalList();
  }
});

$("gameDetailClose").addEventListener("click", closeGameDetail);
$("gameDetailOverlay").addEventListener("click", e => { if(e.target.id === "gameDetailOverlay") closeGameDetail(); });

document.addEventListener("click", (e)=>{
  const mid = e.target.dataset.delMatch;
  const dg = e.target.dataset.deleteGame;
  const dl = e.target.dataset.deleteLocation;
  const openGame = e.target.dataset.openGame;
  const editMatch = e.target.dataset.editMatch;

  if(openGame) openGameDetail(openGame);
  if(editMatch) openEditMatch(editMatch);

  if(mid && confirm("¿Borrar esta partida?")){
    state.matches = state.matches.filter(p=>p.id!==mid);
    saveState(); render();
  }

  if(dg && confirm(`¿Borrar el juego "${dg}"?`)){
    if(state.matches.some(p=>p.juego===dg)) return alert("No se puede borrar un juego que ya tiene partidas. Podés renombrarlo o borrar primero esas partidas.");
    state.games = state.games.filter(g=>g!==dg);
    const map = gameColorMap(); delete map[dg]; gameColors = map;
    saveState(); render(); renderModalList();
  }

  if(dl && confirm(`¿Borrar la locación "${dl}"?`)){
    if(state.matches.some(p=>p.lugar===dl)) return alert("No se puede borrar una locación que ya tiene partidas. Podés renombrarla o borrar primero esas partidas.");
    state.locations = state.locations.filter(l=>l!==dl);
    saveState(); render(); renderModalList();
  }
});


$("editMatchClose").addEventListener("click", closeEditMatch);
$("editMatchOverlay").addEventListener("click", e => { if(e.target.id === "editMatchOverlay") closeEditMatch(); });
$("editMatchForm").addEventListener("submit", saveEditedMatch);
$("deleteMatchFromEdit").addEventListener("click", deleteEditedMatch);

window.addEventListener("resize", () => {
  clearTimeout(chartResizeTimer);
  chartResizeTimer = setTimeout(() => {
    renderCharts();
    if(activeGameDetail) renderGameDetail();
  }, 150);
});

function setCloudAccess(ready){
  cloudReady=ready;
  document.body.classList.toggle("cloud-unavailable",!ready);
  const form=$("matchForm");
  if(form) for(const el of form.elements) el.disabled=!ready;
}
async function initCloudSync(){
  setCloudAccess(false);
  status("Conectando con Firebase...");
  if(!firebaseEnabled){status("Firebase no configurado · carga bloqueada");render();return;}
  try{
    // Creación atómica: dos teléfonos que abren por primera vez no pisan datos.
    await runTransaction(db,async transaction=>{
      const snap=await transaction.get(cloudDocRef);
      if(!snap.exists()) transaction.set(cloudDocRef,{...state,updatedAt:new Date().toISOString()});
    });
    onSnapshot(cloudDocRef,snapshot=>{
      if(!snapshot.exists()) {setCloudAccess(false);status("Base en nube no disponible");return;}
      if(snapshot.metadata.hasPendingWrites)return;
      const cloud=snapshot.data();
      state={games:cloud.games||[],locations:cloud.locations||[],matches:cloud.matches||[]};
      lastCloudMatches=structuredClone(state.matches);
      setCloudAccess(true);
      status("Sincronizado con Firebase · solo nube");
      render();
    },err=>{console.error(err);setCloudAccess(false);status("Sin conexión a Firebase · carga bloqueada");});
  }catch(err){console.error(err);setCloudAccess(false);status("Error de Firebase · carga bloqueada");render();}
}
$("downloadBackup").addEventListener("click",downloadBackup);
$("importBackup").addEventListener("change",e=>{importBackup(e.target.files[0]);e.target.value="";});
initCloudSync();

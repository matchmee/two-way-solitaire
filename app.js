(function(){
'use strict';

const RANKS = [null,'A','2','3','4','5','6','7','8','9','10','J','Q','K'];

const state = {
  stock: [], waste: [],
  foundations: [[],[],[],[]],
  tableaus: [[],[],[],[],[],[],[]],
  undo: [],
  selected: null,
  manualScale: 1.0,
  fitMode: true,
};

const BASE_CARD_H = 90;
const BASE_CARD_W = Math.round(BASE_CARD_H/1.47);
const BASE_FAN    = Math.round(BASE_CARD_H*0.16);
const MIN_SCALE   = 0.55;
const MAX_SCALE   = 1.20;

function newDeck(){
  const deck=[];
  for(let copy=0; copy<4; copy++){
    for(let r=1;r<=13;r++){
      deck.push({r, id:`${copy}-${r}-${Math.random().toString(36).slice(2,6)}`, face:'up'});
    }
  }
  for (let i=deck.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [deck[i],deck[j]]=[deck[j],deck[i]];
  }
  return deck;
}

function deal(){
  const deck = newDeck();
  for(let i=0;i<7;i++){
    state.tableaus[i]=[];
    for(let k=0;k<i;k++){
      const c = deck.pop(); c.face='down'; state.tableaus[i].push(c);
    }
    const up = deck.pop(); up.face='up'; state.tableaus[i].push(up);
  }
  state.stock = deck;
}

function setup(){
  state.undo.length=0;
  state.selected=null;
  for(let i=0;i<4;i++) state.foundations[i]=[];
  for(let i=0;i<7;i++) state.tableaus[i]=[];
  state.waste=[];
  deal();
  render();
  setStatus("Fit is ON: tallest stack fills the screen. Turn off to use slider cap.");
  persist();
}

function rankLabel(r){ return RANKS[r]; }

function render(){
  document.querySelectorAll('.pile').forEach(el=>{
    el.innerHTML='';
    el.classList.remove('empty');
    if (el.classList.contains('tableau')){
      el.style.height = ''; // reset; set below
    }
  });
  const stockEl = qs('[data-pile="STOCK"]');
  if (state.stock.length===0){ stockEl.classList.add('empty'); }
  else stockEl.appendChild(ce('div','card facedown'));

  const wasteEl = qs('[data-pile="WASTE"]');
  if (state.waste.length===0) wasteEl.classList.add('empty');
  else wasteEl.appendChild(cardEl(state.waste[state.waste.length-1], true));

  for(let i=0;i<4;i++){
    const fEl = qs(`[data-pile="F${i}"]`);
    const f = state.foundations[i];
    if (!f.length) fEl.classList.add('empty');
    else fEl.appendChild(cardEl(f[f.length-1], true));
  }

  const cs = getComputedStyle(document.documentElement);
  const cardH = parseFloat(cs.getPropertyValue('--card-h'))||BASE_CARD_H;
  const fan = parseFloat(cs.getPropertyValue('--fan'))||BASE_FAN;
  let tallestPx = cardH;

  for(let i=0;i<7;i++){
    const tEl = qs(`[data-pile="T${i}"]`);
    const t = state.tableaus[i];
    if (!t.length) tEl.classList.add('empty');
    t.forEach((c, idx)=>{
      const el = cardEl(c, idx===t.length-1 && c.face==='up');
      el.style.setProperty('--offset', idx.toString());
      el.style.setProperty('--z', idx.toString());
      tEl.appendChild(el);
    });
    const h = Math.round(cardH + fan * Math.max(0, t.length-1));
    tEl.style.height = h + 'px';
    tallestPx = Math.max(tallestPx, h);
  }

  // Make the row consume the available space so there is no giant gap
  const row = document.getElementById('tabRow');
  row.style.minHeight = Math.round(tallestPx + 2) + 'px';

  rafAutoFit();
  attachInteractions();
  checkWin();
}

function cardEl(card, isTopUp){
  const el = ce('div','card');
  if (card.face==='down') el.classList.add('facedown');
  else { el.classList.add('faceup'); el.textContent = `${rankLabel(card.r)}♠`; }
  if (isTopUp) el.classList.add('top');
  if (state.selected && state.selected.id===card.id) el.classList.add('select');
  return el;
}

function attachInteractions(){
  qsAll('.pile').forEach(el=>el.onclick = ()=>onPileTap(el.dataset.pile));
}

function onPileTap(pid){
  if (pid==='STOCK'){
    if (state.stock.length){
      pushUndo();
      const c = state.stock.pop(); c.face='up'; state.waste.push(c);
      setStatus("Dealt 1 to Waste.");
      render(); persist(); return;
    } else if (state.waste.length){
      pushUndo(); while(state.waste.length) state.stock.push(state.waste.pop());
      setStatus("Recycled Waste back to Stock.");
      render(); persist(); return;
    }
    return;
  }

  const top = peekTopFaceUp(pid);
  if (!top){ setStatus("No face‑up card here."); return; }

  if (tryAutoMove(top)){ render(); persist(); return; }
  state.selected = top; render();
  setStatus(`Selected ${label(top)}. Tap a destination.`);
}

function tryAutoMove(card){
  const fromPid = findTopPile(card.id); if (!fromPid) return false;
  const fTargets = foundationTargets(card);
  if (fTargets.length){ pushUndo(); moveCard(fromPid, fTargets[0]); postMoveFlip(fromPid); setStatus(`Auto → Foundation (${fTargets[0]}).`); return true; }
  const tTargets = tableauTargets(card);
  if (tTargets.length){ pushUndo(); moveCard(fromPid, tTargets[0]); postMoveFlip(fromPid); setStatus(`Auto → Tableau (${tTargets[0]}).`); return true; }
  return false;
}

function foundationTargets(card){
  const out=[]; for(let i=0;i<4;i++){ const f=state.foundations[i];
    if (!f.length && card.r===1) out.push(`F${i}`);
    else if (f.length && card.r===f[f.length-1].r+1) out.push(`F${i}`);
  } return out;
}

function tableauTargets(card){
  const options=[]; for(let i=0;i<7;i++){ const t=state.tableaus[i];
    if (!t.length) options.push({pid:`T${i}`,score:0});
    else { const top = topFaceUpOfTableau(i); if (!top) continue;
      const diff = Math.abs(card.r - top.r); if (diff===1) options.push({pid:`T${i}`,score:100+t.length});
    }
  } options.sort((a,b)=>b.score-a.score);
  return options.map(o=>o.pid).filter((pid,i,a)=>a.indexOf(pid)===i);
}

function topFaceUpOfTableau(i){ const t=state.tableaus[i]; for(let k=t.length-1;k>=0;k--){ if (t[k].face==='up') return t[k]; } return null; }

function peekTopFaceUp(pid){
  if (pid.startsWith('F')){ const f=state.foundations[+pid[1]]; return f[f.length-1]||null; }
  if (pid.startsWith('T')){ return topFaceUpOfTableau(+pid[1]); }
  if (pid==='WASTE'){ return state.waste[state.waste.length-1]||null; }
  return null;
}

function findTopPile(cardId){
  for(let i=0;i<7;i++){ const t=state.tableaus[i]; if (!t.length) continue;
    for(let k=t.length-1;k>=0;k--){ if (t[k].face==='up'){ if (t[k].id===cardId) return `T${i}`; break; } else break; } }
  for(let i=0;i<4;i++){ const f=state.foundations[i]; if (f.length && f[f.length-1].id===cardId) return `F${i}`; }
  if (state.waste.length && state.waste[state.waste.length-1].id===cardId) return 'WASTE';
  return null;
}

function moveCard(fromPid, toPid){
  let card=null;
  if (fromPid.startsWith('T')){ card = popTopFaceUpFromTableau(+fromPid[1]); }
  else if (fromPid.startsWith('F')){ card = state.foundations[+fromPid[1]].pop(); }
  else if (fromPid==='WASTE'){ card = state.waste.pop(); }
  if (!card) return;
  if (toPid.startsWith('T')) state.tableaus[+toPid[1]].push(card);
  else if (toPid.startsWith('F')) state.foundations[+toPid[1]].push(card);
}

function popTopFaceUpFromTableau(i){
  const t=state.tableaus[i];
  for(let k=t.length-1;k>=0;k--){ if (t[k].face==='up') return t.splice(k,1)[0]; else break; }
  return null;
}

function postMoveFlip(fromPid){
  if (!fromPid.startsWith('T')) return;
  const t=state.tableaus[+fromPid[1]]; if (!t.length) return;
  const top=t[t.length-1]; if (top.face==='down'){ top.face='up'; setStatus("Flipped a card."); }
}

function label(c){ return `${RANKS[c.r]}♠`; }

function pushUndo(){ const snap=JSON.stringify({stock:state.stock,waste:state.waste,foundations:state.foundations,tableaus:state.tableaus}); state.undo.push(snap); if (state.undo.length>200) state.undo.shift(); }
function undo(){ const s=state.undo.pop(); if(!s){setStatus("Nothing to undo.");return;} Object.assign(state, JSON.parse(`{"x":0}`)); const o=JSON.parse(s); state.stock=o.stock; state.waste=o.waste; state.foundations=o.foundations; state.tableaus=o.tableaus; state.selected=null; render(); persist(); setStatus("Undid last move."); }

function checkWin(){ const total=state.foundations.reduce((a,f)=>a+f.length,0); if (total===52) setStatus("You win! 🎉"); }

function setStatus(msg){ qs('#status').textContent = msg; }

function qs(s){ return document.querySelector(s); }
function qsAll(s){ return document.querySelectorAll(s); }
function ce(tag, cls){ const el=document.createElement(tag); if (cls) el.className=cls; return el; }

function persist(){
  try{ localStorage.setItem('twosol_v38_prefs', JSON.stringify({manualScale:state.manualScale, fitMode:state.fitMode})); }catch(e){}
}
function restorePrefs(){
  try{ const s=localStorage.getItem('twosol_v38_prefs'); if(!s) return; const p=JSON.parse(s); state.manualScale=p.manualScale??1.0; state.fitMode = p.fitMode??true; }catch(e){}
}

/* ===== Layout & Fit ===== */
function lockMainHeight(){
  const hdr = document.getElementById('hdr');
  const ftr = document.getElementById('ftr');
  const main = document.getElementById('mainArea');
  const vh = (window.visualViewport ? window.visualViewport.height : window.innerHeight);
  const h = Math.max(120, Math.floor(vh - hdr.offsetHeight - ftr.offsetHeight - 8));
  main.style.height = h + 'px';
  return h;
}

function autoFit(){
  const main = document.getElementById('mainArea');
  const found = document.getElementById('foundRow');
  const row = document.getElementById('tabRow');

  const mainH = main.clientHeight;
  const avail = Math.max(120, mainH - found.offsetHeight - 8);

  let maxN = 1;
  for (let i=0;i<7;i++) maxN = Math.max(maxN, state.tableaus[i].length);

  const baseStack = BASE_CARD_H + BASE_FAN*(maxN-1);
  let target = avail / baseStack;  // exact fill
  target = Math.max(MIN_SCALE, Math.min(MAX_SCALE, target));

  let effective = target;
  if (!state.fitMode){
    effective = Math.min(target, state.manualScale);
  }

  const h = Math.round(BASE_CARD_H * effective);
  const w = Math.round(BASE_CARD_W * effective);
  const fan = Math.max(6, Math.round(BASE_FAN * effective));

  const root = document.documentElement;
  root.style.setProperty('--card-h', h+'px');
  root.style.setProperty('--card-w', w+'px');
  root.style.setProperty('--fan', fan+'px');

  // Also set the row min-height to exactly fill the remainder
  const stackPx = h + fan * Math.max(0, maxN-1);
  row.style.minHeight = Math.round(stackPx+2) + 'px';
}

let rafId=null;
function scheduleFit(){
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(()=>{
    lockMainHeight();
    requestAnimationFrame(autoFit);
  });
}

function initControls(){
  const slider = document.getElementById('scaleRange');
  const out = document.getElementById('scaleOut');
  const fit = document.getElementById('fitToggle');
  if (slider){ slider.value = Math.round(state.manualScale*100); slider.oninput = slider.onchange = ()=>{ state.manualScale = Math.max(0.6, Math.min(1.2, (parseInt(slider.value,10)||100)/100)); out.textContent = Math.round(state.manualScale*100)+'%'; persist(); scheduleFit(); }; out.textContent = Math.round(state.manualScale*100)+'%'; }
  if (fit){ fit.checked = !!state.fitMode; fit.onchange = ()=>{ state.fitMode = fit.checked; persist(); scheduleFit(); }; }
}

['resize','orientationchange'].forEach(ev=>window.addEventListener(ev, scheduleFit));

window.addEventListener('load', ()=>{
  restorePrefs();
  initControls();
  qs('#newGameBtn').addEventListener('click', ()=>{ setup(); });
  qs('#undoBtn').addEventListener('click', undo);
  qs('#helpBtn').addEventListener('click', ()=>alert('Tap a face‑up card to auto‑move; build up or down by 1; Stock deals to Waste; recycle Waste onto empty Stock.'));

  setup(); // creates a new game on first load
  if ('serviceWorker' in navigator){ navigator.serviceWorker.register('./service-worker.js'); }
});

})();
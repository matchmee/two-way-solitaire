(function(){
'use strict';

const RANKS = [null,'A','2','3','4','5','6','7','8','9','10','J','Q','K'];

const state = {
  stock: [], waste: [],
  foundations: [[],[],[],[]],
  tableaus: [[],[],[],[],[],[],[]],
  undo: [],
  select: null, // {pile:'T3', index: n} start of run (face-up)
  manualScale: 1.0,
  fitMode: true,
};

const BASE_CARD_H = 90;
const BASE_CARD_W = Math.round(BASE_CARD_H/1.47);
const BASE_FAN    = Math.round(BASE_CARD_H*0.16);
const MIN_SCALE   = 0.55;
const MAX_SCALE   = 1.20;

/* ---------- Game setup ---------- */
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

/* ---------- Fit calculation FIRST ---------- */
function computeTargetScale(){
  const main = document.getElementById('mainArea');
  const found = document.getElementById('foundRow');

  // ensure main is height-locked
  lockMainHeight();
  const mainH = main.clientHeight;
  const avail = Math.max(120, mainH - found.offsetHeight - 8);

  let maxN = 1;
  for (let i=0;i<7;i++) maxN = Math.max(maxN, state.tableaus[i].length);

  const baseStack = BASE_CARD_H + BASE_FAN*(maxN-1);
  let target = avail / baseStack; // exact fill
  target = Math.max(MIN_SCALE, Math.min(MAX_SCALE, target));

  if (!state.fitMode) target = Math.min(target, state.manualScale);

  return target;
}

function applyScale(scale){
  const h = Math.round(BASE_CARD_H * scale);
  const w = Math.round(BASE_CARD_W * scale);
  const fan = Math.max(6, Math.round(BASE_FAN * scale));
  const root = document.documentElement;
  root.style.setProperty('--card-h', h+'px');
  root.style.setProperty('--card-w', w+'px');
  root.style.setProperty('--fan', fan+'px');
}

/* ---------- Render ---------- */
function render(){
  // 1) compute & apply scale first
  const s = computeTargetScale();
  applyScale(s);

  // 2) clear piles
  document.querySelectorAll('.pile').forEach(el=>{ el.innerHTML=''; el.classList.remove('empty'); });

  // 3) foundations/stock/waste
  const stockEl = qs('[data-pile="STOCK"]');
  if (state.stock.length===0) stockEl.classList.add('empty');
  else stockEl.appendChild(ce('div','card facedown'));
  const wasteEl = qs('[data-pile="WASTE"]');
  if (!state.waste.length) wasteEl.classList.add('empty');
  else wasteEl.appendChild(cardEl(state.waste.at(-1), {top:true}));
  for(let i=0;i<4;i++){
    const fEl = qs(`[data-pile="F${i}"]`);
    const f = state.foundations[i];
    if (!f.length) fEl.classList.add('empty'); else fEl.appendChild(cardEl(f.at(-1), {top:true}));
  }

  // 4) tableaus (with real heights)
  const cs = getComputedStyle(document.documentElement);
  const cardH = parseFloat(cs.getPropertyValue('--card-h'));
  const fan = parseFloat(cs.getPropertyValue('--fan'));
  let tallestPx = cardH;

  for(let i=0;i<7;i++){
    const tEl = qs(`[data-pile="T${i}"]`);
    const t = state.tableaus[i];
    if (!t.length) tEl.classList.add('empty');
    t.forEach((c, idx)=>{
      const isTopUp = idx===t.length-1 && c.face==='up';
      const el = cardEl(c, {top:isTopUp, pile:`T${i}`, index:idx, face:c.face});
      el.style.setProperty('--offset', idx.toString());
      el.style.setProperty('--z', idx.toString());
      tEl.appendChild(el);
    });
    const h = Math.round(cardH + fan * Math.max(0, t.length-1));
    tEl.style.height = h + 'px';
    tallestPx = Math.max(tallestPx, h);
  }
  const row = document.getElementById('tabRow');
  row.style.minHeight = Math.round(tallestPx + 2) + 'px';

  // 5) interactions
  attachInteractions();
  checkWin();
}

function cardEl(card, {top=false, pile=null, index=null, face='up'}={}){
  const el = ce('div','card');
  if (face==='down'){ el.classList.add('facedown'); }
  else { el.classList.add('faceup'); el.textContent = `${RANKS[card.r]}♠`; }
  if (top) el.classList.add('top');
  el.dataset.id = card.id;
  if (pile!==null) { el.dataset.pile = pile; el.dataset.index = index; }
  if (state.select && state.select.pile && state.select.id===card.id) el.classList.add('select');
  return el;
}

function attachInteractions(){
  // pile taps
  qsAll('.pile').forEach(el=>{
    el.onclick = (ev)=>{
      const pid = el.dataset.pile;
      onPileTap(pid, ev);
    };
  });
  // card taps (for selecting run starts)
  qsAll('.card.faceup').forEach(el=>{
    const pid = el.dataset.pile;
    const idx = parseInt(el.dataset.index,10);
    if (pid && !isNaN(idx)){
      el.onclick = (e)=>{ e.stopPropagation(); onCardTap(pid, idx); };
    }
  });
}

function onCardTap(pid, idx){
  if (!pid.startsWith('T')) return; // run selection only within tableau
  const i = +pid[1];
  const t = state.tableaus[i];
  // can only start on a face-up card
  if (t[idx].face!=='up'){ setStatus("That card is face‑down."); return; }
  state.select = {pile:pid, index:idx, id:t[idx].id};
  setStatus("Selected a run. Tap a destination tableau.");
  render();
}

function onPileTap(pid, ev){
  if (pid==='STOCK'){
    if (state.stock.length){
      pushUndo();
      const c = state.stock.pop(); c.face='up'; state.waste.push(c);
      setStatus("Dealt 1 to Waste."); render(); persist(); return;
    } else if (state.waste.length){
      pushUndo(); while(state.waste.length) state.stock.push(state.waste.pop());
      setStatus("Recycled Waste back to Stock."); render(); persist(); return;
    }
    return;
  }
  if (pid==='WASTE'){
    const c = state.waste.at(-1);
    if (!c){ setStatus("Waste is empty."); return; }
    // prefer auto move
    if (tryAutoMoveSingle('WASTE', c)){ render(); persist(); return; }
    state.select = {pile:'WASTE', index:state.waste.length-1, id:c.id};
    setStatus("Selected top Waste card."); render(); return;
  }

  // Move from selection if present
  if (state.select){
    if (pid.startsWith('T')){
      if (tryMoveSelectionToTableau(pid)){ render(); persist(); return; }
      setStatus("That move isn’t legal.");
      return;
    } else if (pid.startsWith('F')){
      if (tryMoveSelectionToFoundation(pid)){ render(); persist(); return; }
      setStatus("Only single cards can go to Foundations in-order.");
      return;
    }
  }

  // otherwise: try auto move of top face-up
  const top = peekTopFaceUp(pid);
  if (!top){ setStatus("No face‑up card here."); return; }
  if (tryAutoMoveSingle(pid, top)){ render(); persist(); return; }
  setStatus("No auto‑move available. Tap a face‑up card to select a run.");
}

function tryAutoMoveSingle(fromPid, card){
  // prefer Foundations
  const f = foundationTargets(card);
  if (f.length){ pushUndo(); moveOne(fromPid, f[0]); postMoveFlip(fromPid); setStatus(`Auto → Foundation (${f[0]}).`); return true; }
  const t = tableauTargetsSingle(card);
  if (t.length){ pushUndo(); moveOne(fromPid, t[0]); postMoveFlip(fromPid); setStatus(`Auto → Tableau (${t[0]}).`); return true; }
  return false;
}

/* ---------- Run move rules ---------- */
function tryMoveSelectionToTableau(destPid){
  const sel = state.select; if (!sel) return false;
  const run = getSelectedRun(sel);
  if (!run.cards.length) return false;
  const ok = canPlaceRunOnTableau(run.cards[0], destPid);
  if (!ok) return false;
  pushUndo();
  removeSelectedRun(sel);
  placeRunOnTableau(run.cards, destPid);
  postMoveFlip(sel.pile);
  state.select = null;
  setStatus(`Moved ${run.cards.length} cards → ${destPid}.`);
  return true;
}

function tryMoveSelectionToFoundation(destPid){
  const sel = state.select; if (!sel) return false;
  const run = getSelectedRun(sel);
  if (run.cards.length!==1) return false; // only single card to foundation
  const c = run.cards[0];
  const ok = foundationTargets(c).includes(destPid);
  if (!ok) return false;
  pushUndo();
  removeSelectedRun(sel);
  state.foundations[+destPid[1]].push(c);
  postMoveFlip(sel.pile);
  state.select = null;
  setStatus(`Moved ${label(c)} → ${destPid}.`);
  return true;
}

function getSelectedRun(sel){
  if (sel.pile==='WASTE' || sel.pile.startsWith('F')){
    const c = sel.pile==='WASTE' ? state.waste.at(-1) : state.foundations[+sel.pile[1]].at(-1);
    return {cards: c ? [c] : []};
  }
  const i = +sel.pile[1];
  const t = state.tableaus[i];
  const cards = t.slice(sel.index).filter(c=>c.face==='up');
  return {cards};
}

function removeSelectedRun(sel){
  if (sel.pile.startsWith('T')){
    const i = +sel.pile[1];
    state.tableaus[i] = state.tableaus[i].slice(0, sel.index);
  } else if (sel.pile==='WASTE'){
    state.waste.pop();
  } else if (sel.pile.startsWith('F')){
    state.foundations[+sel.pile[1]].pop();
  }
}

function placeRunOnTableau(cards, pid){
  state.tableaus[+pid[1]].push(...cards);
}

function canPlaceRunOnTableau(firstCard, destPid){
  const t = state.tableaus[+destPid[1]];
  if (!t.length) return true; // any run may go to empty column
  // must be +/- 1 relative to top face-up of dest
  let top=null;
  for (let k=t.length-1;k>=0;k--){ if (t[k].face==='up'){ top=t[k]; break; } else break; }
  if (!top) return true;
  return Math.abs(firstCard.r - top.r)===1;
}

/* ---------- Single card placement helpers ---------- */
function foundationTargets(card){
  const out=[];
  for(let i=0;i<4;i++){
    const f = state.foundations[i];
    if (!f.length && card.r===1) out.push(`F${i}`);
    else if (f.length && card.r===f.at(-1).r+1) out.push(`F${i}`);
  }
  return out;
}
function tableauTargetsSingle(card){
  const options=[];
  for(let i=0;i<7;i++){
    const t = state.tableaus[i];
    if (!t.length) options.push(`T${i}`);
    else {
      let top=null;
      for (let k=t.length-1;k>=0;k--){ if (t[k].face==='up'){ top=t[k]; break; } else break; }
      if (!top) options.push(`T${i}`);
      else if (Math.abs(card.r - top.r)===1) options.push(`T${i}`);
    }
  }
  return options;
}

function moveOne(fromPid, toPid){
  let card=null;
  if (fromPid.startsWith('T')){
    const i=+fromPid[1];
    for (let k=state.tableaus[i].length-1;k>=0;k--){
      if (state.tableaus[i][k].face==='up'){ card = state.tableaus[i].splice(k,1)[0]; break; }
      else break;
    }
  } else if (fromPid==='WASTE'){ card = state.waste.pop(); }
  else if (fromPid.startsWith('F')){ card = state.foundations[+fromPid[1]].pop(); }
  if (!card) return;
  if (toPid.startsWith('T')) state.tableaus[+toPid[1]].push(card);
  else if (toPid.startsWith('F')) state.foundations[+toPid[1]].push(card);
}

function postMoveFlip(fromPid){
  if (!fromPid || !fromPid.startsWith('T')) return;
  const i = +fromPid[1];
  const t = state.tableaus[i];
  if (!t.length) return;
  const top = t.at(-1);
  if (top.face==='down'){ top.face='up'; }
}

function label(c){ return `${RANKS[c.r]}♠`; }

/* ---------- Undo / Save ---------- */
function pushUndo(){
  const snap = JSON.stringify({stock:state.stock, waste:state.waste, foundations:state.foundations, tableaus:state.tableaus});
  state.undo.push(snap); if (state.undo.length>200) state.undo.shift();
}
function undo(){
  const s=state.undo.pop(); if(!s){ setStatus("Nothing to undo."); return; }
  const o=JSON.parse(s);
  state.stock=o.stock; state.waste=o.waste; state.foundations=o.foundations; state.tableaus=o.tableaus;
  state.select=null; render(); persist(); setStatus("Undid last move.");
}

function persist(){ try{ localStorage.setItem('twosol_v39_prefs', JSON.stringify({manualScale:state.manualScale, fitMode:state.fitMode})); }catch(e){} }
function restorePrefs(){ try{ const s=localStorage.getItem('twosol_v39_prefs'); if(!s) return; const p=JSON.parse(s); state.manualScale=p.manualScale??1.0; state.fitMode=p.fitMode??true; }catch(e){} }

/* ---------- Layout ---------- */
function lockMainHeight(){
  const hdr = document.getElementById('hdr');
  const ftr = document.getElementById('ftr');
  const main = document.getElementById('mainArea');
  const vh = (window.visualViewport ? window.visualViewport.height : window.innerHeight);
  const h = Math.max(120, Math.floor(vh - hdr.offsetHeight - ftr.offsetHeight - 8));
  main.style.height = h + 'px';
  return h;
}

let rafId=null;
function scheduleRender(){
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(()=>{ render(); });
}

['resize','orientationchange'].forEach(ev=>window.addEventListener(ev, scheduleRender));

/* ---------- Controls ---------- */
function initControls(){
  const slider = document.getElementById('scaleRange');
  const out = document.getElementById('scaleOut');
  const fit = document.getElementById('fitToggle');
  if (slider){ slider.value = Math.round(state.manualScale*100);
    slider.oninput = slider.onchange = ()=>{
      state.manualScale = Math.max(0.6, Math.min(1.2, (parseInt(slider.value,10)||100)/100));
      out.textContent = Math.round(state.manualScale*100)+'%'; persist(); scheduleRender();
    };
    out.textContent = Math.round(state.manualScale*100)+'%';
  }
  if (fit){ fit.checked = !!state.fitMode;
    fit.onchange = ()=>{ state.fitMode = fit.checked; persist(); scheduleRender(); };
  }
  qs('#newGameBtn').onclick = ()=>{ deal(); state.undo.length=0; state.select=null; scheduleRender(); setStatus("New deal."); };
  qs('#undoBtn').onclick = ()=>undo();
  qs('#helpBtn').onclick = ()=>alert('Tap a face‑up card in a column to select a run; tap a destination column to move the whole run (must be +1 or -1). Foundations build A→K (single cards). Stock deals to Waste; tap empty Stock to recycle Waste.');
}

function checkWin(){ const total = state.foundations.reduce((a,f)=>a+f.length,0); if (total===52) setStatus("You win! 🎉"); }
function setStatus(msg){ qs('#status').textContent = msg; }

function qs(s){ return document.querySelector(s); }
function qsAll(s){ return document.querySelectorAll(s); }
function ce(tag, cls){ const el=document.createElement(tag); if (cls) el.className=cls; return el; }

window.addEventListener('load', ()=>{
  restorePrefs();
  initControls();
  deal();
  scheduleRender();
  if ('serviceWorker' in navigator){ navigator.serviceWorker.register('./service-worker.js'); }
});

})();
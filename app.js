(function(){
'use strict';

const RANKS = [null,'A','2','3','4','5','6','7','8','9','10','J','Q','K'];

const state = {
  stock: [], waste: [],
  foundations: [[],[],[],[]],
  tableaus: [[],[],[],[],[],[],[]],
  undo: [],
  selection: null, // {pile:'T3', index:n, id}
  manualScale: 1.0,
  fitMode: true,
};

const BASE_CARD_H = 90;
const BASE_CARD_W = Math.round(BASE_CARD_H/1.47);
const BASE_FAN    = Math.round(BASE_CARD_H*0.16);
const MIN_SCALE   = 0.55;
const MAX_SCALE   = 1.20;

/* Utils */
const qs  = (s)=>document.querySelector(s);
const qsA = (s)=>document.querySelectorAll(s);
const ce  = (t,c)=>{const e=document.createElement(t); if(c) e.className=c; return e;};
const label = (c)=>`${RANKS[c.r]}♠`;
const setStatus = (m)=>qs('#status').textContent=m;

/* Deck & Deal */
function newDeck(){
  const deck=[];
  for(let copy=0; copy<4; copy++){ for(let r=1;r<=13;r++){ deck.push({r, id:`${copy}-${r}-${Math.random().toString(36).slice(2,6)}`, face:'up'}); } }
  for(let i=deck.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [deck[i],deck[j]]=[deck[j],deck[i]]; }
  return deck;
}
function deal(){
  const deck=newDeck();
  for(let i=0;i<7;i++){
    state.tableaus[i]=[];
    for(let k=0;k<i;k++){ const c=deck.pop(); c.face='down'; state.tableaus[i].push(c); }
    const up=deck.pop(); up.face='up'; state.tableaus[i].push(up);
  }
  state.stock=deck;
}

/* Layout */
function lockMainHeight(){
  const hdr=qs('#hdr'), ftr=qs('#ftr'), main=qs('#mainArea');
  const vh = (window.visualViewport? window.visualViewport.height : window.innerHeight);
  const h = Math.max(120, Math.floor(vh - hdr.offsetHeight - ftr.offsetHeight - 8));
  main.style.height = h+'px';
  return h;
}
function tallestN(){ let n=1; for(let i=0;i<7;i++) n=Math.max(n,state.tableaus[i].length); return n; }
function computeScaleAndAvail(){
  const mainH = lockMainHeight();
  const foundH = qs('#foundRow').offsetHeight;
  const avail = Math.max(120, mainH - foundH - 8);
  const n = Math.max(1,tallestN());
  const baseStack = BASE_CARD_H + BASE_FAN*(n-1);
  let s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, avail/baseStack));
  if (!state.fitMode) s = Math.min(s, state.manualScale);
  return {s, avail, n};
}
function applyScale(s){
  const h=Math.round(BASE_CARD_H*s);
  const w=Math.round(BASE_CARD_W*s);
  const fan=Math.max(6, Math.round(BASE_FAN*s));
  const root=document.documentElement;
  root.style.setProperty('--card-h', h+'px');
  root.style.setProperty('--card-w', w+'px');
  root.style.setProperty('--fan', fan+'px');
  return {h, fan};
}

/* Render */
function cardEl(card,{top=false,pile=null,index=null}={}){
  const el=ce('div','card'); el.dataset.id=card.id;
  if(card.face==='down') el.classList.add('facedown');
  else { el.classList.add('faceup'); el.textContent=label(card); }
  if(top) el.classList.add('top');
  if(pile){ el.dataset.pile=pile; el.dataset.index=String(index); }
  if(state.selection && state.selection.id===card.id) el.classList.add('select');
  return el;
}
function render(){
  const {s, avail} = computeScaleAndAvail();
  const metrics = applyScale(s);

  // lock tableau row height to available vertical space
  qs('#tabRow').style.height = Math.round(avail)+'px';

  // clear piles
  qsA('.pile').forEach(el=>{ el.innerHTML=''; el.classList.remove('empty'); el.style.height=''; });

  // stock/waste
  const stockEl=qs('[data-pile="STOCK"]');
  if(!state.stock.length) stockEl.classList.add('empty'); else stockEl.appendChild(ce('div','card facedown'));
  const wasteEl=qs('[data-pile="WASTE"]');
  if(!state.waste.length) wasteEl.classList.add('empty'); else wasteEl.appendChild(cardEl(state.waste.at(-1),{top:true}));

  // foundations
  for(let i=0;i<4;i++){
    const fEl=qs(`[data-pile="F${i}"]`), f=state.foundations[i];
    if(!f.length) fEl.classList.add('empty'); else fEl.appendChild(cardEl(f.at(-1),{top:true}));
  }

  // tableaus (TOP-anchored)
  let tallestPx=metrics.h;
  for(let i=0;i<7;i++){
    const t=state.tableaus[i], tEl=qs(`[data-pile="T${i}"]`);
    if(!t.length) tEl.classList.add('empty');
    t.forEach((c,idx)=>{
      const el=cardEl(c,{top: idx===t.length-1 && c.face==='up', pile:`T${i}`, index:idx});
      el.style.setProperty('--offset', idx);
      el.style.setProperty('--z', idx);
      tEl.appendChild(el);
    });
    const h = Math.round(metrics.h + metrics.fan*Math.max(0, t.length-1));
    tEl.style.height = h+'px';
    tallestPx = Math.max(tallestPx, h);
  }

  bindEvents();
  checkWin();
}

/* Interactions */
function bindEvents(){
  // pile taps
  qsA('.pile').forEach(el=>{
    const pid = el.dataset.pile;
    const handler = (e)=>{ e && e.stopPropagation(); onTapPile(pid); };
    el.addEventListener('click', handler, {passive:false});
    el.addEventListener('touchend', handler, {passive:false});
  });
  // card taps
  qsA('.card.faceup').forEach(el=>{
    const pid = el.dataset.pile;
    const idx = parseInt(el.dataset.index||'-1',10);
    if (!pid || isNaN(idx)) return;
    const handler = (e)=>{ e.stopPropagation(); onTapCard(pid, idx); };
    el.addEventListener('click', handler, {passive:false});
    el.addEventListener('touchend', handler, {passive:false});
  });
}
function onTapPile(pid){
  if(pid==='STOCK'){
    if(state.stock.length){ pushUndo(); const c=state.stock.pop(); c.face='up'; state.waste.push(c); setStatus('Dealt 1 to Waste.'); render(); persist(); return; }
    if(state.waste.length){ pushUndo(); while(state.waste.length) state.stock.push(state.waste.pop()); setStatus('Recycled Waste.'); render(); persist(); return; }
    return;
  }
  if(state.selection){
    if(pid.startsWith('T')){ if(tryMoveSelectionToTableau(pid)){ render(); persist(); return; } setStatus("That move isn’t legal."); return; }
    if(pid.startsWith('F')){ if(tryMoveSelectionToFoundation(pid)){ render(); persist(); return; } setStatus("Only single cards to Foundations."); return; }
  }
  const top = peekTopFaceUp(pid); if(!top){ setStatus('No face‑up card here.'); return; }
  if(tryAutoMoveSingle(pid, top)){ render(); persist(); return; }
  if(pid.startsWith('T')){ const i=+pid[1]; const idx=indexOfTopFaceUp(i); if(idx>=0){ selectRun(pid, idx); render(); } }
}
function onTapCard(pid, idx){
  if(!pid.startsWith('T')) return;
  const i=+pid[1];
  if(state.tableaus[i][idx].face!=='up'){ setStatus('That card is face‑down.'); return; }
  if(idx===indexOfTopFaceUp(i)){
    const top=state.tableaus[i][idx];
    if(tryAutoMoveSingle(`T${i}`, top)){ render(); persist(); return; }
  }
  selectRun(pid, idx); render();
}
function selectRun(pid, idx){
  const i=+pid[1], card=state.tableaus[i][idx];
  state.selection={pile:pid, index:idx, id:card.id};
  setStatus(`Selected run from ${label(card)}. Tap destination.`);
}

/* Move logic */
function foundationTargets(card){
  const out=[]; for(let i=0;i<4;i++){ const f=state.foundations[i];
    if(!f.length && card.r===1) out.push(`F${i}`);
    else if(f.length && card.r===f.at(-1).r+1) out.push(`F${i}`);
  } return out;
}
function tableauTargetsSingle(card){
  const out=[]; for(let i=0;i<7;i++){ const top=topFaceUp(i); const t=state.tableaus[i];
    if(!t.length || !top) out.push(`T${i}`);
    else if(Math.abs(card.r - top.r)===1) out.push(`T${i}`);
  } return out;
}
function tryAutoMoveSingle(fromPid, card){
  const f=foundationTargets(card); if(f.length){ pushUndo(); moveOne(fromPid,f[0]); postMoveFlip(fromPid); setStatus(`Auto → Foundation (${f[0]}).`); return true; }
  const t=tableauTargetsSingle(card); if(t.length){ pushUndo(); moveOne(fromPid,t[0]); postMoveFlip(fromPid); setStatus(`Auto → Tableau (${t[0]}).`); return true; }
  return false;
}
function tryMoveSelectionToTableau(destPid){
  const sel=state.selection; if(!sel) return false;
  const run=getRun(sel); if(!run.length) return false;
  if(!canPlaceRunOnTableau(run[0], destPid)) return false;
  pushUndo(); removeRun(sel); placeRunOnTableau(run, destPid); postMoveFlip(sel.pile); state.selection=null; setStatus(`Moved ${run.length} → ${destPid}.`); return true;
}
function tryMoveSelectionToFoundation(destPid){
  const sel=state.selection; if(!sel) return false;
  const run=getRun(sel); if(run.length!==1) return false;
  if(!foundationTargets(run[0]).includes(destPid)) return false;
  pushUndo(); removeRun(sel); state.foundations[+destPid[1]].push(run[0]); postMoveFlip(sel.pile); state.selection=null; return true;
}
function getRun(sel){
  if(sel.pile==='WASTE'){ return state.waste.length?[state.waste.at(-1)]:[]; }
  if(sel.pile.startsWith('F')){ const f=state.foundations[+sel.pile[1]]; return f.length?[f.at(-1)]:[]; }
  const i=+sel.pile[1]; const t=state.tableaus[i]; return t.slice(sel.index).filter(c=>c.face==='up');
}
function removeRun(sel){
  if(sel.pile==='WASTE'){ state.waste.pop(); return; }
  if(sel.pile.startsWith('F')){ state.foundations[+sel.pile[1]].pop(); return; }
  const i=+sel.pile[1]; state.tableaus[i]=state.tableaus[i].slice(0, sel.index);
}
function placeRunOnTableau(cards, pid){ state.tableaus[+pid[1]].push(...cards); }
function canPlaceRunOnTableau(firstCard, destPid){
  const t=state.tableaus[+destPid[1]]; const top=topFaceUp(+destPid[1]);
  if(!t.length || !top) return true;
  return Math.abs(firstCard.r - top.r)===1;
}
function moveOne(fromPid, toPid){
  let c=null;
  if(fromPid.startsWith('T')){ const i=+fromPid[1]; const idx=indexOfTopFaceUp(i); if(idx>=0) c=state.tableaus[i].splice(idx,1)[0]; }
  else if(fromPid==='WASTE'){ c=state.waste.pop(); }
  else if(fromPid.startsWith('F')){ c=state.foundations[+fromPid[1]].pop(); }
  if(!c) return;
  if(toPid.startsWith('T')) state.tableaus[+toPid[1]].push(c);
  else if(toPid.startsWith('F')) state.foundations[+toPid[1]].push(c);
}
function postMoveFlip(fromPid){
  if(!fromPid || !fromPid.startsWith('T')) return;
  const i=+fromPid[1], t=state.tableaus[i];
  if(!t.length) return; const top=t.at(-1); if(top.face==='down') top.face='up';
}
function indexOfTopFaceUp(i){ const t=state.tableaus[i]; for(let k=t.length-1;k>=0;k--){ if(t[k].face==='up') return k; else break; } return -1; }
function topFaceUp(i){ const idx=indexOfTopFaceUp(i); return idx>=0?state.tableaus[i][idx]:null; }

/* Undo & Save */
function pushUndo(){ const snap=JSON.stringify({stock:state.stock,waste:state.waste,foundations:state.foundations,tableaus:state.tableaus}); state.undo.push(snap); if(state.undo.length>200) state.undo.shift(); }
function undo(){ const s=state.undo.pop(); if(!s){ setStatus('Nothing to undo.'); return; } const o=JSON.parse(s); state.stock=o.stock; state.waste=o.waste; state.foundations=o.foundations; state.tableaus=o.tableaus; state.selection=null; render(); persist(); setStatus('Undid last move.'); }
function persist(){ try{ localStorage.setItem('twosol_v41_prefs', JSON.stringify({manualScale:state.manualScale, fitMode:state.fitMode})); }catch(e){} }
function restore(){ try{ const s=localStorage.getItem('twosol_v41_prefs'); if(!s) return; const p=JSON.parse(s); state.manualScale=p.manualScale??1.0; state.fitMode=p.fitMode??true; }catch(e){} }

/* Controls */
function initControls(){
  const slider=qs('#scaleRange'), out=qs('#scaleOut'), fit=qs('#fitToggle');
  slider.value=Math.round(state.manualScale*100); out.textContent = Math.round(state.manualScale*100)+'%';
  slider.addEventListener('input', ()=>{ state.manualScale=Math.max(0.6, Math.min(1.2, (parseInt(slider.value,10)||100)/100)); out.textContent=Math.round(state.manualScale*100)+'%'; persist(); render(); });
  slider.addEventListener('change', ()=>{ state.manualScale=Math.max(0.6, Math.min(1.2, (parseInt(slider.value,10)||100)/100)); out.textContent=Math.round(state.manualScale*100)+'%'; persist(); render(); });
  fit.checked=!!state.fitMode;
  fit.addEventListener('change', ()=>{ state.fitMode = fit.checked; persist(); render(); });
  qs('#newGameBtn').addEventListener('click', ()=>{ deal(); state.undo.length=0; state.selection=null; render(); setStatus('New deal.'); });
  qs('#undoBtn').addEventListener('click', ()=>undo());
  qs('#helpBtn').addEventListener('click', ()=>alert('Rules: build up or down by 1. Tap top card to auto‑move; tap any lower face‑up to select a run, then tap a destination column. Foundations A→K single cards. Stock → Waste; tap empty Stock to recycle Waste.'));
}

['resize','orientationchange'].forEach(ev=>window.addEventListener(ev, ()=>render()));

window.addEventListener('load', ()=>{
  restore();
  deal();
  initControls();
  render();
  if('serviceWorker' in navigator){ navigator.serviceWorker.register('./service-worker.js'); }
});

})();
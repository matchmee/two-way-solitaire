(function(){
'use strict';

const RANKS = [null,'A','2','3','4','5','6','7','8','9','10','J','Q','K'];

const state = {
  stock: [], waste: [],
  foundations: [[],[],[],[]],
  tableaus: [[],[],[],[],[],[],[]],
  undo: [],
  selected: null,
};

// Base metrics for scaling
const BASE_CARD_H = 100;      // px
const BASE_CARD_W = Math.round(BASE_CARD_H/1.47);
const BASE_FAN    = Math.round(BASE_CARD_H*0.16);
const MIN_SCALE   = 0.45;     // don't go too tiny
const MAX_SCALE   = 1.0;

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
  setStatus("Auto‑fit on. Stacks will always fit the screen.");
  persist();
}

function rankLabel(r){ return RANKS[r]; }

function render(){
  document.querySelectorAll('.pile').forEach(el=>{
    el.innerHTML='';
    el.classList.remove('empty');
  });
  const stockEl = qs('[data-pile="STOCK"]');
  if (state.stock.length===0){ stockEl.classList.add('empty'); }
  else {
    const back = ce('div','card facedown');
    stockEl.appendChild(back);
  }
  const wasteEl = qs('[data-pile="WASTE"]');
  if (state.waste.length===0) wasteEl.classList.add('empty');
  else wasteEl.appendChild(cardEl(state.waste[state.waste.length-1], true));

  for(let i=0;i<4;i++){
    const fEl = qs(`[data-pile="F${i}"]`);
    const f = state.foundations[i];
    if (f.length===0) fEl.classList.add('empty');
    else fEl.appendChild(cardEl(f[f.length-1], true));
  }
  for(let i=0;i<7;i++){
    const tEl = qs(`[data-pile="T${i}"]`);
    const t = state.tableaus[i];
    if (t.length===0) tEl.classList.add('empty');
    t.forEach((c, idx)=>{
      const el = cardEl(c, idx===t.length-1 && c.face==='up');
      el.style.setProperty('--offset', idx.toString());
      el.style.setProperty('--z', idx.toString());
      tEl.appendChild(el);
    });
  }

  autoFitColumns();
  attachInteractions();
  checkWin();
}

function cardEl(card, isTopUp){
  const el = ce('div','card');
  if (card.face==='down'){
    el.classList.add('facedown');
  } else {
    el.classList.add('faceup');
    el.textContent = `${rankLabel(card.r)}♠`;
  }
  if (isTopUp) el.classList.add('top');
  if (state.selected && state.selected.id===card.id) el.classList.add('select');
  return el;
}

function attachInteractions(){
  qsAll('.pile').forEach(el=>{
    el.onclick = ()=>onPileTap(el.dataset.pile);
  });
}

function onPileTap(pid){
  if (pid==='STOCK'){
    if (state.stock.length>0){
      pushUndo();
      const c = state.stock.pop();
      c.face='up';
      state.waste.push(c);
      setStatus("Dealt 1 to Waste.");
      render(); persist();
      return;
    } else if (state.waste.length>0){
      pushUndo();
      while(state.waste.length) state.stock.push(state.waste.pop());
      setStatus("Recycled Waste back to Stock.");
      render(); persist();
      return;
    }
    return;
  }

  const top = peekTopFaceUp(pid);
  if (!top){ setStatus("No face‑up card here."); return; }

  if (tryAutoMove(top)){
    render(); persist();
    return;
  }
  state.selected = top;
  render();
  setStatus(`Selected ${label(top)}. Tap a destination.`);
}

function tryAutoMove(card){
  const fromPid = findTopPile(card.id);
  if (!fromPid) return false;
  const fTargets = foundationTargets(card);
  if (fTargets.length){
    pushUndo();
    moveCard(fromPid, fTargets[0]);
    postMoveFlip(fromPid);
    setStatus(`Auto → Foundation (${fTargets[0]}).`);
    return true;
  }
  const tTargets = tableauTargets(card);
  if (tTargets.length){
    pushUndo();
    moveCard(fromPid, tTargets[0]);
    postMoveFlip(fromPid);
    setStatus(`Auto → Tableau (${tTargets[0]}).`);
    return true;
  }
  return false;
}

function foundationTargets(card){
  const out=[];
  for(let i=0;i<4;i++){
    const f = state.foundations[i];
    if (f.length===0 && card.r===1) out.push(`F${i}`);
    else if (f.length && card.r===f[f.length-1].r+1) out.push(`F${i}`);
  }
  return out;
}

function tableauTargets(card){
  const options=[];
  for(let i=0;i<7;i++){
    const t = state.tableaus[i];
    if (t.length===0) options.push({pid:`T${i}`, score:0});
    else {
      const top = topFaceUpOfTableau(i);
      if (!top) continue;
      const diff = Math.abs(card.r - top.r);
      if (diff===1){
        options.push({pid:`T${i}`, score:100 + t.length});
      }
    }
  }
  options.sort((a,b)=>b.score-a.score);
  return options.map(o=>o.pid).filter((pid, idx, arr)=>arr.indexOf(pid)===idx);
}

function topFaceUpOfTableau(i){
  const t = state.tableaus[i];
  for(let k=t.length-1;k>=0;k--){
    if (t[k].face==='up') return t[k];
  }
  return null;
}

function peekTopFaceUp(pid){
  if (pid.startsWith('F')){
    const i=+pid[1]; const f=state.foundations[i];
    return f[f.length-1]||null;
  }
  if (pid.startsWith('T')){
    const i=+pid[1];
    return topFaceUpOfTableau(i);
  }
  if (pid==='WASTE'){
    return state.waste[state.waste.length-1]||null;
  }
  return null;
}

function findTopPile(cardId){
  for(let i=0;i<7;i++){
    const t=state.tableaus[i];
    if (!t.length) continue;
    for(let k=t.length-1;k>=0;k--){
      if (t[k].face==='up'){
        if (t[k].id===cardId) return `T${i}`;
        break;
      } else break;
    }
  }
  for(let i=0;i<4;i++){
    const f=state.foundations[i]; if (f.length && f[f.length-1].id===cardId) return `F${i}`;
  }
  if (state.waste.length && state.waste[state.waste.length-1].id===cardId) return 'WASTE';
  return null;
}

function moveCard(fromPid, toPid){
  let card=null;
  if (fromPid.startsWith('T')){
    const i = +fromPid[1];
    card = popTopFaceUpFromTableau(i);
  } else if (fromPid.startsWith('F')){
    card = state.foundations[+fromPid[1]].pop();
  } else if (fromPid==='WASTE'){
    card = state.waste.pop();
  }
  if (!card) return;

  if (toPid.startsWith('T')) state.tableaus[+toPid[1]].push(card);
  else if (toPid.startsWith('F')) state.foundations[+toPid[1]].push(card);
}

function popTopFaceUpFromTableau(i){
  const t = state.tableaus[i];
  for(let k=t.length-1;k>=0;k--){
    if (t[k].face==='up'){
      return t.splice(k,1)[0];
    } else break;
  }
  return null;
}

function postMoveFlip(fromPid){
  if (!fromPid.startsWith('T')) return;
  const i = +fromPid[1];
  const t = state.tableaus[i];
  if (!t.length) return;
  const top = t[t.length-1];
  if (top.face==='down'){
    top.face='up';
    setStatus("Flipped a card.");
  }
}

function label(c){ return `${rankLabel(c.r)}♠`; }

function pushUndo(){
  const snapshot = JSON.stringify({
    stock: state.stock, waste: state.waste,
    foundations: state.foundations, tableaus: state.tableaus
  });
  state.undo.push(snapshot);
  if (state.undo.length>200) state.undo.shift();
}
function undo(){
  const snap = state.undo.pop();
  if (!snap){ setStatus("Nothing to undo."); return; }
  const obj = JSON.parse(snap);
  state.stock = obj.stock;
  state.waste = obj.waste;
  state.foundations = obj.foundations;
  state.tableaus = obj.tableaus;
  state.selected = null;
  render(); persist();
  setStatus("Undid last move.");
}

function checkWin(){
  const total = state.foundations.reduce((a,f)=>a+f.length,0);
  if (total===52) setStatus("You win! 🎉");
}

function setStatus(msg){ qs('#status').textContent = msg; }

function qs(s){ return document.querySelector(s); }
function qsAll(s){ return document.querySelectorAll(s); }
function ce(tag, cls){ const el=document.createElement(tag); if (cls) el.className=cls; return el; }

function persist(){
  try{
    const save = {
      stock: state.stock, waste: state.waste,
      foundations: state.foundations, tableaus: state.tableaus,
      undo: state.undo
    };
    localStorage.setItem('twosol_v32_save', JSON.stringify(save));
  }catch(e){}
}
function restore(){
  try{
    const s = localStorage.getItem('twosol_v32_save');
    if (!s) return false;
    const obj = JSON.parse(s);
    state.stock = obj.stock||[]; state.waste = obj.waste||[];
    state.foundations = obj.foundations||[[],[],[],[]];
    state.tableaus = obj.tableaus||[[],[],[],[],[],[],[]];
    state.undo = obj.undo||[];
    render();
    setStatus("Game restored.");
    return true;
  }catch(e){ return false; }
}

/* ===== Auto-fit logic ===== */
function autoFitColumns(){
  // find tallest tableau stack length
  let maxN = 0;
  for (let i=0;i<7;i++) maxN = Math.max(maxN, state.tableaus[i].length);
  if (maxN < 1) maxN = 1;
  const main = document.getElementById('mainArea');
  const avail = main ? main.clientHeight : (window.innerHeight - 92); // px
  const target = Math.max(100, Math.floor(avail*0.92)); // use 92% of area
  const baseStack = BASE_CARD_H + BASE_FAN*(maxN-1);
  let scale = Math.min(MAX_SCALE, target / baseStack);
  if (!isFinite(scale) || scale<=0) scale = MAX_SCALE;
  if (scale < MIN_SCALE) scale = MIN_SCALE;

  const h = Math.round(BASE_CARD_H * scale);
  const w = Math.round(BASE_CARD_W * scale);
  const fan = Math.max(8, Math.round(BASE_FAN * scale));

  const root = document.documentElement;
  root.style.setProperty('--card-h', h+'px');
  root.style.setProperty('--card-w', w+'px');
  root.style.setProperty('--fan', fan+'px');
}

window.addEventListener('resize', ()=>autoFitColumns());

window.addEventListener('load', ()=>{
  qs('#newGameBtn').addEventListener('click', setup);
  qs('#undoBtn').addEventListener('click', undo);
  qs('#helpBtn').addEventListener('click', ()=>qs('#helpDialog').showModal());
  qs('#closeHelp').addEventListener('click', ()=>qs('#helpDialog').close());

  if (!restore()) setup();

  if ('serviceWorker' in navigator){
    navigator.serviceWorker.register('./service-worker.js');
  }
});

})();
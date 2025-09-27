(function(){
'use strict';

const SUITS = ['♠'];
const RANKS = [null,'A','2','3','4','5','6','7','8','9','10','J','Q','K'];

const state = {
  stock: [], waste: [],
  foundations: [[],[],[],[]],
  tableaus: [[],[],[],[],[],[],[]],
  undo: [],
  selected: null,
};

function newDeck(){
  const deck=[];
  for(let copy=0; copy<4; copy++){
    for(let r=1;r<=13;r++){
      deck.push({s:0, r, id:`${copy}-0-${r}-${Math.random().toString(36).slice(2,6)}`});
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
    for(let k=0;k<3;k++) state.tableaus[i].push(deck.pop());
  }
  for(let i=0;i<7;i++){
    if (i<4) state.tableaus[i].push(deck.pop());
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
  setStatus("New game. Tap a top card to auto-move; Stock deals to Waste.");
  persist();
}

function suitSymbol(){ return '♠'; }
function rankLabel(r){ return RANKS[r]; }

function render(){
  document.querySelectorAll('.pile').forEach(el=>{
    el.innerHTML='';
    el.classList.remove('empty');
  });
  const stockEl = qs('[data-pile="STOCK"]');
  if (state.stock.length===0){ stockEl.classList.add('empty'); }
  else {
    const back = ce('div','card'); back.textContent='🂠';
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
      const el = cardEl(c, idx===t.length-1);
      el.style.setProperty('--offset', (t.length-1-idx).toString());
      tEl.appendChild(el);
    });
  }
  attachInteractions();
  checkWin();
}

function cardEl(card, isTop){
  const el = ce('div','card');
  el.dataset.card = card.id;
  el.classList.toggle('top', !!isTop);
  el.textContent = `${rankLabel(card.r)}${suitSymbol()}`;
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
      state.waste.push(state.stock.pop());
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

  const top = peekTop(pid);
  if (!top){ setStatus("No card here."); return; }

  if (tryAutoMove(top)){
    render(); persist();
    return;
  }

  state.selected = top;
  render();
  setStatus(`Selected ${label(top)}. Tap a destination.`);
}

function tryAutoMove(card){
  const fromPid = findCardPile(card.id);
  if (!fromPid) return false;
  const fTargets = foundationTargets(card);
  if (fTargets.length){
    pushUndo();
    moveCard(fromPid, fTargets[0]);
    setStatus(`Auto → Foundation (${fTargets[0]}).`);
    return true;
  }
  const tTargets = tableauTargets(card);
  if (tTargets.length){
    pushUndo();
    moveCard(fromPid, tTargets[0]);
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
      const top = t[t.length-1];
      const diff = Math.abs(card.r - top.r);
      if (diff===1){
        options.push({pid:`T${i}`, score:100 + t.length});
      }
    }
  }
  options.sort((a,b)=>b.score-a.score);
  return options.map(o=>o.pid).filter((pid, idx, arr)=>arr.indexOf(pid)===idx);
}

function peekTop(pid){
  if (pid.startsWith('F')){
    const i=+pid[1]; const f=state.foundations[i];
    return f[f.length-1]||null;
  }
  if (pid.startsWith('T')){
    const i=+pid[1]; const t=state.tableaus[i];
    return t[t.length-1]||null;
  }
  if (pid==='WASTE'){
    return state.waste[state.waste.length-1]||null;
  }
  return null;
}

function findCardPile(cardId){
  for(let i=0;i<7;i++){ const t=state.tableaus[i]; if (t.length && t[t.length-1].id===cardId) return `T${i}`; }
  for(let i=0;i<4;i++){ const f=state.foundations[i]; if (f.length && f[f.length-1].id===cardId) return `F${i}`; }
  if (state.waste.length && state.waste[state.waste.length-1].id===cardId) return 'WASTE';
  return null;
}

function canMove(card, toPid){
  if (toPid==='STOCK' || toPid==='WASTE') return false;
  if (toPid.startsWith('F')){
    const f = state.foundations[+toPid[1]];
    if (f.length===0) return card.r===1;
    return card.r===f[f.length-1].r+1;
  }
  if (toPid.startsWith('T')){
    const t = state.tableaus[+toPid[1]];
    if (t.length===0) return true;
    const top = t[t.length-1];
    return Math.abs(card.r - top.r)===1;
  }
  return false;
}

function moveCard(fromPid, toPid){
  let card=null;
  if (fromPid.startsWith('T')) card = state.tableaus[+fromPid[1]].pop();
  else if (fromPid.startsWith('F')) card = state.foundations[+fromPid[1]].pop();
  else if (fromPid==='WASTE') card = state.waste.pop();
  if (!card) return;

  if (toPid.startsWith('T')) state.tableaus[+toPid[1]].push(card);
  else if (toPid.startsWith('F')) state.foundations[+toPid[1]].push(card);
}

function label(c){ return `${rankLabel(c.r)}${suitSymbol()}`; }

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
    localStorage.setItem('twosol_v2_save', JSON.stringify(save));
  }catch(e){}
}
function restore(){
  try{
    const s = localStorage.getItem('twosol_v2_save');
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
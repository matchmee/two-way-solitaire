(function(){
'use strict';

// Suits & ranks
const SUITS = ['♠','♥','♦','♣'];
const RED = new Set(['♥','♦']);
const RANKS = [null,'A','2','3','4','5','6','7','8','9','10','J','Q','K'];

const state = {
  piles: {}, // pileId -> [cards]
  stock: [], waste: [],
  foundations: [[],[],[],[]],
  tableaus: [[],[],[],[],[]],
  undo: [],
  selected: null,
};

function newDeck(){
  const deck=[];
  for(let s=0;s<4;s++){
    for(let r=1;r<=13;r++){
      deck.push({s, r, id:`${s}-${r}`});
    }
  }
  // shuffle
  for (let i=deck.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [deck[i],deck[j]]=[deck[j],deck[i]];
  }
  return deck;
}

function setup(){
  // reset
  state.undo.length=0;
  state.selected = null;
  for(let i=0;i<4;i++) state.foundations[i]=[];
  for(let i=0;i<5;i++) state.tableaus[i]=[];
  state.waste=[];

  const deck = newDeck();
  // deal 5 tableaus with one card each to start (simple, keeps it fast)
  for(let i=0;i<5;i++){
    state.tableaus[i].push(deck.pop());
  }
  // remaining to stock
  state.stock = deck;
  render();
  setStatus("New game. Tap a card, then tap a destination.");
  persist();
}

function suitSymbol(s){ return SUITS[s]; }
function rankLabel(r){ return RANKS[r]; }

function render(){
  // clear all piles
  const pileEls = document.querySelectorAll('.pile');
  pileEls.forEach(el=>{
    el.innerHTML = '';
    el.classList.remove('empty');
  });
  // Stock
  const stockEl = qs(`[data-pile="STOCK"]`);
  if (state.stock.length===0){
    stockEl.classList.add('empty');
  } else {
    // show a face-down back
    const back = ce('div','card');
    back.textContent = '🂠';
    stockEl.appendChild(back);
  }
  // Waste
  const wasteEl = qs(`[data-pile="WASTE"]`);
  if (state.waste.length===0) wasteEl.classList.add('empty');
  else {
    const top = state.waste[state.waste.length-1];
    wasteEl.appendChild(cardEl(top,true));
  }
  // Foundations
  for(let i=0;i<4;i++){
    const fEl = qs(`[data-pile="F${i}"]`);
    const f = state.foundations[i];
    if (f.length===0) fEl.classList.add('empty');
    else fEl.appendChild(cardEl(f[f.length-1], true));
  }
  // Tableaus
  for(let i=0;i<5;i++){
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
  const sym = suitSymbol(card.s);
  const isRed = RED.has(sym);
  if (isRed) el.classList.add('red');
  el.textContent = `${rankLabel(card.r)}${sym}`;
  if (state.selected && state.selected.id === card.id) el.classList.add('select');
  return el;
}

function attachInteractions(){
  // tap handlers
  qsAll('.pile').forEach(el=>{
    el.onclick = ()=>onPileTap(el.dataset.pile);
  });
}

function onPileTap(pid){
  if (pid==='STOCK'){
    if (state.stock.length>0){
      pushUndo();
      state.waste.push(state.stock.pop());
      setStatus("Dealt 1 to waste.");
      render(); persist();
      return;
    } else {
      // recycle
      if (state.waste.length>0){
        pushUndo();
        // flip waste back to stock
        while(state.waste.length) state.stock.push(state.waste.pop());
        setStatus("Recycled waste back to stock.");
        render(); persist();
      }
      return;
    }
  }

  const topCard = peekTop(pid);
  if (!state.selected){
    if (topCard){
      state.selected = topCard;
      render();
      setStatus(`Selected ${label(topCard)}. Choose destination.`);
    }
    return;
  } else {
    // try move selected to this pile
    const fromPid = findCardPile(state.selected.id);
    if (!fromPid){ state.selected = null; render(); return; }
    if (fromPid===pid){ state.selected=null; render(); setStatus("Selection cleared."); return; }
    if (canMove(state.selected, pid)){
      pushUndo();
      moveCard(fromPid, pid);
      state.selected = null;
      render(); persist();
      return;
    } else {
      // illegal; if there is a top card here, switch selection
      if (topCard){ state.selected = topCard; render(); setStatus(`Selected ${label(topCard)}.`); }
      else setStatus("Move not allowed here.");
      return;
    }
  }
}

function peekTop(pid){
  if (pid.startsWith('F')){
    const i = +pid[1]; const f = state.foundations[i];
    return f[f.length-1]||null;
  }
  if (pid.startsWith('T')){
    const i = +pid[1]; const t = state.tableaus[i];
    return t[t.length-1]||null;
  }
  if (pid==='WASTE'){
    return state.waste[state.waste.length-1]||null;
  }
  return null;
}
function findCardPile(cardId){
  // returns pile id containing that card as top (we only move tops)
  for(let i=0;i<5;i++){
    const t=state.tableaus[i]; if (t.length && t[t.length-1].id===cardId) return `T${i}`;
  }
  for(let i=0;i<4;i++){
    const f=state.foundations[i]; if (f.length && f[f.length-1].id===cardId) return `F${i}`;
  }
  if (state.waste.length && state.waste[state.waste.length-1].id===cardId) return 'WASTE';
  return null;
}

function canMove(card, toPid){
  if (toPid==='STOCK') return false;
  if (toPid==='WASTE') return false;

  if (toPid.startsWith('F')){
    // suit must match foundation index? We'll bind suits 0..3 to F0..F3 for simplicity.
    const fIndex = +toPid[1];
    const f = state.foundations[fIndex];
    // Each foundation is a single suit; determine suit by first card placed.
    if (f.length===0) return card.r===1; // must be Ace to start
    // suit must match suit of foundation's first card
    const suit = f[0].s;
    if (card.s!==suit) return false;
    return card.r===f[f.length-1].r+1;
  }

  if (toPid.startsWith('T')){
    const tIndex = +toPid[1];
    const t = state.tableaus[tIndex];
    if (t.length===0) return true; // any single card to empty
    const top = t[t.length-1];
    // Two-way build: difference of 1 up or down allowed; suits ignored
    const diff = Math.abs(card.r - top.r);
    return diff===1;
  }
  return false;
}

function moveCard(fromPid, toPid){
  let card=null;
  if (fromPid.startsWith('T')){ card = state.tableaus[+fromPid[1]].pop(); }
  else if (fromPid.startsWith('F')){ card = state.foundations[+fromPid[1]].pop(); }
  else if (fromPid==='WASTE'){ card = state.waste.pop(); }
  if (!card) return;

  if (toPid.startsWith('T')) state.tableaus[+toPid[1]].push(card);
  else if (toPid.startsWith('F')){
    const f = state.foundations[+toPid[1]];
    // if empty, lock this foundation suit to the card's suit by placing it
    f.push(card);
  }
  setStatus(`Moved ${label(card)} to ${toPid}.`);
}

function label(c){ return `${rankLabel(c.r)}${suitSymbol(c.s)}`; }

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
  const complete = state.foundations.every(f=>f.length===13);
  if (complete){
    setStatus("You win! 🎉 All foundations complete.");
  }
}

function setStatus(msg){ qs('#status').textContent = msg; }

// DOM helpers
function qs(s){ return document.querySelector(s); }
function qsAll(s){ return document.querySelectorAll(s); }
function ce(tag, cls){ const el=document.createElement(tag); if (cls) el.className=cls; return el; }

// Persistence (so it works truly offline and resumes)
function persist(){
  try {
    const save = {
      stock: state.stock, waste: state.waste,
      foundations: state.foundations, tableaus: state.tableaus,
      undo: state.undo
    };
    localStorage.setItem('twosol_save', JSON.stringify(save));
  } catch(e){}
}
function restore(){
  try{
    const s = localStorage.getItem('twosol_save');
    if (!s) return false;
    const obj = JSON.parse(s);
    state.stock = obj.stock||[]; state.waste = obj.waste||[];
    state.foundations = obj.foundations||[[],[],[],[]];
    state.tableaus = obj.tableaus||[[],[],[],[],[]];
    state.undo = obj.undo||[];
    render();
    setStatus("Game restored.");
    return true;
  }catch(e){ return false; }
}

// UI buttons
window.addEventListener('load', ()=>{
  qs('#newGameBtn').addEventListener('click', setup);
  qs('#undoBtn').addEventListener('click', undo);
  qs('#helpBtn').addEventListener('click', ()=>qs('#helpDialog').showModal());
  qs('#closeHelp').addEventListener('click', ()=>qs('#helpDialog').close());

  if (!restore()) setup();

  // Register service worker
  if ('serviceWorker' in navigator){
    navigator.serviceWorker.register('./service-worker.js');
  }
});

})();
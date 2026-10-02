const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const app = express();
app.use(express.static("public"));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map();
const PORT = process.env.PORT || 3000;
const TURN_SECONDS = 5;

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function broadcast(room, obj) {
  room.players.forEach(p => send(p.ws, obj));
}
function publicState(room) {
  return {
    code: room.code,
    status: room.status,
    currentWord: room.currentWord,
    nextChar: room.currentWord ? room.currentWord.slice(-1) : "",
    used: Array.from(room.used),
    turn: room.players[room.turnIndex]?.id || null,
    turnIndex: room.turnIndex,
    players: room.players.map(p => ({
      id:p.id, name:p.name, alive:p.alive, score:p.score
    })),
    timeLeft: room.deadline ? Math.max(0, Math.ceil((room.deadline-Date.now())/1000)) : 0
  };
}
function state(room) { broadcast(room, {type:"state", state:publicState(room)}); }

function cleanupRoom(room) {
  if (room.timer) clearInterval(room.timer);
  rooms.delete(room.code);
}

function startRoom(room) {
  if (room.status !== "waiting") return;
  if (room.players.length < 2) return;
  room.status = "playing";
  room.turnIndex = 0;
  startTurnTimer(room);
  state(room);
}

function activePlayers(room) {
  return room.players.filter(p => p.alive);
}

function nextAliveIndex(room, from) {
  const n = room.players.length;
  for (let step=1; step<=n; step++) {
    const i=(from+step)%n;
    if (room.players[i].alive) return i;
  }
  return -1;
}

function finishIfOne(room) {
  const alive = activePlayers(room);
  if (alive.length <= 1) {
    room.status="finished";
    if (room.timer) clearInterval(room.timer);
    state(room);
    return true;
  }
  return false;
}

function startTurnTimer(room) {
  if (room.timer) clearInterval(room.timer);
  room.deadline = Date.now() + TURN_SECONDS*1000;
  room.timer = setInterval(() => {
    if (room.status !== "playing") return;
    const left=Math.max(0,Math.ceil((room.deadline-Date.now())/1000));
    broadcast(room,{type:"timer",timeLeft:left});
    if (Date.now() >= room.deadline) {
      eliminateCurrent(room, "시간 초과");
    }
  },250);
}

function eliminateCurrent(room, reason) {
  const p=room.players[room.turnIndex];
  if (!p || !p.alive) return;
  p.alive=false;
  broadcast(room,{type:"notice",message:`${p.name} 탈락 — ${reason}`});
  if (finishIfOne(room)) return;
  room.turnIndex=nextAliveIndex(room,room.turnIndex);
  startTurnTimer(room);
  state(room);
}

function normalizeWord(raw) {
  return String(raw||"").trim().replace(/\s+/g,"");
}
function isKoreanWord(word) {
  return /^[가-힣]{2,20}$/.test(word);
}

wss.on("connection", ws => {
  const id=crypto.randomUUID();
  let player=null, room=null;

  ws.on("message", raw => {
    let msg;
    try { msg=JSON.parse(raw.toString()); } catch { return; }

    if (msg.type==="create") {
      if (room) return;
      const code=makeCode();
      room={code,status:"waiting",players:[],used:new Set(),currentWord:"",turnIndex:0,deadline:0,timer:null};
      rooms.set(code,room);
      const name=String(msg.name||"플레이어").trim().slice(0,12)||"플레이어";
      player={id,name,ws,alive:true,score:0};
      room.players.push(player);
      send(ws,{type:"joined",id,code});
      state(room);
      return;
    }

    if (msg.type==="join") {
      if (room) return;
      const code=String(msg.code||"").trim().toUpperCase();
      const target=rooms.get(code);
      if (!target) return send(ws,{type:"error",message:"방을 찾을 수 없습니다."});
      if (target.status!=="waiting") return send(ws,{type:"error",message:"이미 시작된 방입니다."});
      if (target.players.length>=4) return send(ws,{type:"error",message:"방이 꽉 찼습니다."});
      const name=String(msg.name||"플레이어").trim().slice(0,12)||"플레이어";
      player={id,name,ws,alive:true,score:0};
      room=target; room.players.push(player);
      send(ws,{type:"joined",id,code});
      state(room);
      return;
    }

    if (!room || !player) return;

    if (msg.type==="start") {
      if (room.players[0]?.id !== player.id) return;
      if (room.players.length<2) return send(ws,{type:"error",message:"최소 2명이 필요합니다."});
      startRoom(room);
      return;
    }

    if (msg.type==="word") {
      if (room.status!=="playing") return;
      if (room.players[room.turnIndex]?.id !== player.id) return;
      if (!player.alive) return;

      const word=normalizeWord(msg.word);
      if (!isKoreanWord(word)) return send(ws,{type:"error",message:"두 글자 이상의 한글 단어만 입력하세요."});
      if (room.used.has(word)) return send(ws,{type:"error",message:"이미 나온 단어입니다."});
      if (room.currentWord && word[0]!==room.currentWord.slice(-1)) {
        return send(ws,{type:"error",message:`"${room.currentWord.slice(-1)}"으로 시작해야 합니다.`});
      }

      room.used.add(word);
      room.currentWord=word;
      player.score++;
      room.turnIndex=nextAliveIndex(room,room.turnIndex);
      if (finishIfOne(room)) return;
      startTurnTimer(room);
      state(room);
      return;
    }

    if (msg.type==="reset") {
      if (room.players[0]?.id !== player.id) return;
      room.status="waiting"; room.used=new Set(); room.currentWord=""; room.turnIndex=0;
      room.players.forEach(p=>{p.alive=true;p.score=0});
      if (room.timer) clearInterval(room.timer);
      room.deadline=0;
      state(room);
    }
  });

  ws.on("close", () => {
    if (!room || !player) return;
    const idx=room.players.findIndex(p=>p.id===player.id);
    if (idx>=0) room.players.splice(idx,1);
    if (room.players.length===0) return cleanupRoom(room);
    if (room.status==="playing" && player.alive) {
      if (room.turnIndex===idx) room.turnIndex = room.players.length ? idx % room.players.length : 0;
      else if (idx < room.turnIndex) room.turnIndex--;
      finishIfOne(room);
      if (room.status==="playing") {
        room.turnIndex=nextAliveIndex(room,room.turnIndex-1);
        startTurnTimer(room);
      }
    } else if (room.turnIndex >= room.players.length) {
      room.turnIndex=0;
    }
    state(room);
  });
});

server.listen(PORT,()=>console.log(`Word Chain server running on ${PORT}`));

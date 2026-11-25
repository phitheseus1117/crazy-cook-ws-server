const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Crazy COOK WebSocket Relay OK');
});

const wss = new WebSocket.Server({ server });
const rooms = new Map();

function broadcastRoom(roomCode, payload, excludeWs = null) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const raw = JSON.stringify(payload);
  for (const [clientWs] of room.clients.entries()) {
    if (clientWs !== excludeWs && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(raw);
    }
  }
}

function pickSlot(room) {
  const used = new Set(room.players.map(p => p.id));
  for (const sid of ['p1', 'p2', 'p3', 'p4']) {
    if (!used.has(sid) && room.players.length < room.maxPlayers) return sid;
  }
  return null;
}

wss.on('connection', (ws) => {
  ws.on('message', (rawBuf) => {
    let msg;
    try { msg = JSON.parse(rawBuf.toString()); } catch (e) { return; }
    if (!msg || !msg.type) return;

    if (msg.type === 'create_room') {
      const code = String(msg.roomCode || '');
      const maxPlayers = Math.min(4, Math.max(2, Number(msg.maxPlayers) || 2));
      const cleanHostName = (msg.player?.name || '房主').replace(/\s*\(P[1-4](?:\s*房主)?\)\s*$/i, '').trim() || '房主';
      const room = {
        maxPlayers,
        players: [{
          id: 'p1',
          uid: msg.uid,
          name: `${cleanHostName} (P1 房主)`,
          ready: false,
          skin: msg.player?.skin || 'fair',
          band: msg.player?.band || '#E63946',
          bandName: msg.player?.bandName || '紅'
        }],
        clients: new Map([[ws, 'p1']])
      };
      rooms.set(code, room);
      ws._roomCode = code;
      ws._slotId = 'p1';
      ws.send(JSON.stringify({
        type: 'room_created',
        roomCode: code,
        slotId: 'p1',
        maxPlayers,
        players: room.players
      }));
    } else if (msg.type === 'join_room') {
      const code = String(msg.roomCode || '');
      const room = rooms.get(code);
      if (!room) {
        ws.send(JSON.stringify({ type: 'room_error', message: `找不到房號 #${code}，請確認房主已建立房間` }));
        return;
      }
      if (room.players.length >= room.maxPlayers) {
        ws.send(JSON.stringify({ type: 'room_error', message: `房號 #${code} 人數已滿（上限 ${room.maxPlayers} 人）` }));
        return;
      }
      const slotId = pickSlot(room);
      if (!slotId) {
        ws.send(JSON.stringify({ type: 'room_error', message: `房號 #${code} 目前沒有可用座位` }));
        return;
      }

      room.clients.set(ws, slotId);
      ws._roomCode = code;
      ws._slotId = slotId;

      const cleanName = (msg.player?.name || '夥伴').replace(/\s*\(P[1-4]\)\s*$/i, '').trim() || '夥伴';
      room.players.push({
        id: slotId,
        uid: msg.uid,
        name: `${cleanName} (${slotId.toUpperCase()})`,
        ready: false,
        skin: msg.player?.skin || 'fair',
        band: msg.player?.band || '#E63946',
        bandName: msg.player?.bandName || '紅'
      });
      room.players.sort((a, b) => a.id.localeCompare(b.id));

      ws.send(JSON.stringify({
        type: 'slot_assigned',
        roomCode: code,
        slotId,
        maxPlayers: room.maxPlayers
      }));
      broadcastRoom(code, {
        type: 'lobby_state',
        maxPlayers: room.maxPlayers,
        players: room.players
      });
    } else if (ws._roomCode) {
      const code = ws._roomCode;
      const room = rooms.get(code);
      if (!room) return;

      if (msg.type === 'ready_update') {
        const target = room.players.find(p => p.id === ws._slotId);
        if (target) target.ready = !!msg.ready;
        broadcastRoom(code, {
          type: 'lobby_state',
          maxPlayers: room.maxPlayers,
          players: room.players
        });
      } else {
        broadcastRoom(code, { ...msg, fromSlotId: ws._slotId }, ws);
      }
    }
  });

  ws.on('close', () => {
    const code = ws._roomCode;
    const sid = ws._slotId;
    if (!code || !rooms.has(code)) return;
    const room = rooms.get(code);
    room.clients.delete(ws);
    room.players = room.players.filter(p => p.id !== sid);
    if (room.players.length === 0) {
      rooms.delete(code);
    } else {
      broadcastRoom(code, {
        type: 'lobby_state',
        maxPlayers: room.maxPlayers,
        players: room.players
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Crazy COOK WebSocket server listening on port ${PORT}`);
});

(function(){
  const roomEl = document.getElementById('room');
  const nameEl = document.getElementById('name');
  const joinBtn = document.getElementById('joinBtn');
  const leaveBtn = document.getElementById('leaveBtn');
  const muteBtn = document.getElementById('muteBtn');
  const peersEl = document.getElementById('peers');
  const chatEl = document.getElementById('chat');
  const msgEl = document.getElementById('msg');
  const sendBtn = document.getElementById('sendBtn');

  const socket = io('https://hyena-close-purely.ngrok-free.app', { transports: ['websocket'], reconnection: true });

  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }];
  const pcMap = new Map();
  const audioEls = new Map();
  let localStream = null;
  let selfId = null;
  let joined = false;
  let muted = false;
  let displayName = '';

  const addPeerView = (id, name) => {
    const row = document.createElement('div');
    row.className = 'peer';
    row.id = `peer-${id}`;
    row.innerHTML = `<div class="dot" style="width:8px;height:8px;border-radius:999px;background:${id===selfId?'#22d3ee':'#94a3b8'}"></div>
      <div style="flex:1">
        <div style="font-size:14px;opacity:.9">${name}${id===selfId?' (You)':''}</div>
        <div class="vu"><div class="lvl" id="lvl-${id}"></div></div>
      </div>
      <span class="badge">${id.slice(0,5)}</span>`;
    peersEl.appendChild(row);
  };

  const removePeerView = (id) => {
    const row = document.getElementById(`peer-${id}`);
    if (row) row.remove();
  };

  function setLevel(id, value){
    const el = document.getElementById(`lvl-${id}`);
    if (el) el.style.width = `${Math.max(0, Math.min(100, value))}%`;
  }

  async function ensureLocalStream(){
    if (localStream) return localStream;
    localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true, channelCount:1 }, video: false });

    // Local VU meter
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(localStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteTimeDomainData(data);
        let rms = 0; for (let i=0;i<data.length;i++){ const v=(data[i]-128)/128; rms += v*v; }
        rms = Math.sqrt(rms/data.length);
        setLevel(selfId || 'self', Math.floor(Math.min(100, rms*140)));
        requestAnimationFrame(loop);
      };
      loop();
    } catch {}

    return localStream;
  }

  function createPC(peerId, isOfferer){
    if (pcMap.has(peerId)) return pcMap.get(peerId);
    const pc = new RTCPeerConnection({ iceServers });
    pcMap.set(peerId, pc);

    ensureLocalStream().then(stream => {
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('ice-candidate', { to: peerId, candidate: e.candidate });
    };

    pc.ontrack = (e) => {
      let a = audioEls.get(peerId);
      if (!a) {
        a = new Audio(); a.autoplay = true; a.playsInline = true; audioEls.set(peerId, a);
      }
      a.srcObject = e.streams[0];
    };

    pc.onconnectionstatechange = () => {
      if (["failed","disconnected","closed"].includes(pc.connectionState)) {
        pc.close(); pcMap.delete(peerId); audioEls.delete(peerId); removePeerView(peerId);
      }
    };

    (async () => {
      if (isOfferer) {
        try {
          const offer = await pc.createOffer({ offerToReceiveAudio: true });
          await pc.setLocalDescription(offer);
          socket.emit('offer', { to: peerId, sdp: offer });
        } catch {}
      }
    })();

    return pc;
  }

  // Socket.io handlers
  socket.on('connect', () => {
    console.log('Connected to signaling server');
  });

  socket.on('joined', ({ selfId: id, peers }) => {
    selfId = id;
    addPeerView(selfId, displayName || 'Me');
    peers.forEach(p => { addPeerView(p.id, p.name); createPC(p.id, true); });
    joined = true;
    joinBtn.disabled = true; leaveBtn.disabled = false;
  });

  socket.on('new-peer', ({ id, name }) => {
    addPeerView(id, name);
  });

  socket.on('offer', async ({ from, sdp }) => {
    const pc = createPC(from, false);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { to: from, sdp: answer });
  });

  socket.on('answer', async ({ from, sdp }) => {
    const pc = pcMap.get(from); if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  });

  socket.on('ice-candidate', async ({ from, candidate }) => {
    const pc = pcMap.get(from); if (pc && candidate) { try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {} }
  });

  socket.on('text', ({ from, message, timestamp }) => {
    const div = document.createElement('div');
    div.className = 'msg';
    const time = new Date(timestamp).toLocaleTimeString();
    div.innerHTML = `<div><span class="from">${from?.name||'Anon'}</span> <span class="time">${time}</span></div><div>${message}</div>`;
    chatEl.appendChild(div);
    chatEl.scrollTop = chatEl.scrollHeight;
  });

  socket.on('leave', ({ id }) => {
    const pc = pcMap.get(id); if (pc) pc.close();
    pcMap.delete(id); audioEls.delete(id); removePeerView(id);
  });

  // UI actions
  joinBtn.onclick = async () => {
    const room = roomEl.value.trim();
    displayName = nameEl.value.trim();
    if (!room) return alert('Enter a room name');
    try {
      await ensureLocalStream();
      socket.emit('join', { room, name: displayName || undefined });
    } catch (e) { alert('Microphone permission is required.'); }
  };

  leaveBtn.onclick = () => {
    socket.disconnect();
    setTimeout(() => socket.connect(), 300); // reset connection state
    pcMap.forEach(pc => pc.close()); pcMap.clear();
    audioEls.clear();
    peersEl.innerHTML = '';
    joined = false; selfId = null; joinBtn.disabled = false; leaveBtn.disabled = true;
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  };

  muteBtn.onclick = () => {
    if (!localStream) return;
    const t = localStream.getAudioTracks()[0]; if (!t) return;
    t.enabled = !t.enabled; muted = !t.enabled;
    muteBtn.textContent = muted ? 'Unmute Mic' : 'Mute Mic';
  };

  sendBtn.onclick = () => {
    const text = msgEl.value.trim(); if (!text) return;
    socket.emit('text', { message: text }); msgEl.value = '';
  };
  msgEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendBtn.onclick(); });

  // PWA service worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    });
  }
})();
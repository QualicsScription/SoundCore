import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

// Helper: build WS URL from REACT_APP_BACKEND_URL without hardcoding
function buildWsUrl() {
  const base = (import.meta?.env?.REACT_APP_BACKEND_URL || process.env.REACT_APP_BACKEND_URL || '').replace(/\/$/, '');
  if (!base) return '';
  const wsBase = base.startsWith('https') ? base.replace('https', 'wss') : base.replace('http', 'ws');
  return `${wsBase}/ws`;
}

const iceServers = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }
];

function App() {
  const [room, setRoom] = useState('demo');
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [selfId, setSelfId] = useState(null);
  const [participants, setParticipants] = useState({}); // id -> {name, level}
  const [messages, setMessages] = useState([]);
  const [msgText, setMsgText] = useState('');
  const [muted, setMuted] = useState(false);

  const wsRef = useRef(null);
  const pcMapRef = useRef(new Map()); // peerId -> RTCPeerConnection
  const remoteAudioRefs = useRef(new Map()); // peerId -> HTMLAudioElement
  const localStreamRef = useRef(null);
  const localAnalyserRef = useRef(null);
  const rafRef = useRef(null);

  const wsUrl = useMemo(() => buildWsUrl(), []);

  const stopLevelsLoop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  };

  const startLocalMeter = (stream) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      localAnalyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteTimeDomainData(data);
        // Compute RMS
        let rms = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          rms += v * v;
        }
        rms = Math.sqrt(rms / data.length);
        const level = Math.min(100, Math.max(0, Math.floor(rms * 140)));
        setParticipants((prev) => {
          if (!selfId) return prev;
          const p = { ...prev };
          const cur = p[selfId] || { name: name || `Me`, level: 0 };
          p[selfId] = { ...cur, level };
          return p;
        });
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) {
      console.warn('Analyser init failed', e);
    }
  };

  const createPeerConnection = useCallback((peerId, isOfferer) => {
    if (pcMapRef.current.has(peerId)) return pcMapRef.current.get(peerId);
    const pc = new RTCPeerConnection({ iceServers });
    pcMapRef.current.set(peerId, pc);

    // Local tracks
    localStreamRef.current?.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current));

    pc.onicecandidate = (e) => {
      if (e.candidate && wsRef.current) {
        wsRef.current.send(JSON.stringify({ type: 'ice-candidate', to: peerId, candidate: e.candidate }));
      }
    };

    pc.ontrack = (e) => {
      let audio = remoteAudioRefs.current.get(peerId);
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        audio.playsInline = true;
        remoteAudioRefs.current.set(peerId, audio);
      }
      audio.srcObject = e.streams[0];
    };

    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        pc.close();
        pcMapRef.current.delete(peerId);
      }
    };

    (async () => {
      if (isOfferer) {
        try {
          const offer = await pc.createOffer({ offerToReceiveAudio: true });
          await pc.setLocalDescription(offer);
          wsRef.current?.send(JSON.stringify({ type: 'offer', to: peerId, sdp: offer }));
        } catch (e) {
          console.error('Offer error', e);
        }
      }
    })();

    return pc;
  }, [selfId]);

  const handleWsMessage = useCallback(async (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'joined') {
      setSelfId(msg.selfId);
      // Add self participant shell
      setParticipants((prev) => ({ ...prev, [msg.selfId]: { name: name || 'Me', level: 0 } }));
      // Create offers to existing peers
      for (const p of msg.peers || []) {
        setParticipants((prev) => ({ ...prev, [p.id]: { name: p.name || `Peer ${p.id.slice(0,5)}`, level: 0 } }));
        createPeerConnection(p.id, true);
      }
      setJoined(true);
    } else if (msg.type === 'new-peer') {
      setParticipants((prev) => ({ ...prev, [msg.id]: { name: msg.name || `Peer ${msg.id.slice(0,5)}`, level: 0 } }));
      // New peer will initiate offer; nothing to do here
    } else if (msg.type === 'offer') {
      const pc = createPeerConnection(msg.from, false);
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      wsRef.current?.send(JSON.stringify({ type: 'answer', to: msg.from, sdp: answer }));
    } else if (msg.type === 'answer') {
      const pc = pcMapRef.current.get(msg.from);
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    } else if (msg.type === 'ice-candidate') {
      const pc = pcMapRef.current.get(msg.from);
      if (pc && msg.candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch {}
      }
    } else if (msg.type === 'text') {
      setMessages((prev) => [...prev, { from: msg.from, message: msg.message, timestamp: msg.timestamp }]);
    } else if (msg.type === 'leave') {
      const pc = pcMapRef.current.get(msg.id);
      if (pc) pc.close();
      pcMapRef.current.delete(msg.id);
      remoteAudioRefs.current.delete(msg.id);
      setParticipants((prev) => { const p = { ...prev }; delete p[msg.id]; return p; });
    }
  }, [createPeerConnection, name]);

  const joinRoom = useCallback(async () => {
    if (!wsUrl) {
      alert('Backend URL not configured. Please set REACT_APP_BACKEND_URL.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
      localStreamRef.current = stream;
      startLocalMeter(stream);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join', room, name: name || undefined }));
      };
      ws.onmessage = handleWsMessage;
      ws.onclose = () => {
        setJoined(false);
      };
    } catch (e) {
      console.error(e);
      alert('Microphone permission is required.');
    }
  }, [handleWsMessage, name, room, wsUrl]);

  const leaveRoom = useCallback(() => {
    try { wsRef.current?.send(JSON.stringify({ type: 'leave' })); } catch {}
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;
    pcMapRef.current.forEach((pc) => pc.close());
    pcMapRef.current.clear();
    remoteAudioRefs.current.clear();
    setParticipants({});
    setMessages([]);
    setSelfId(null);
    setJoined(false);
    stopLevelsLoop();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
  }, []);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const track = stream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }, []);

  const sendMessage = useCallback(() => {
    const text = msgText.trim();
    if (!text) return;
    wsRef.current?.send(JSON.stringify({ type: 'text', message: text }));
    setMsgText('');
  }, [msgText]);

  useEffect(() => {
    return () => {
      leaveRoom();
    };
  }, [leaveRoom]);

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Ultra-low-latency Voice + Chat</h1>
          <div className="badge">WebRTC + WS</div>
        </header>

        <section className="card p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input className="input md:col-span-1" placeholder="Room name" value={room} onChange={(e) => setRoom(e.target.value)} />
            <input className="input md:col-span-1" placeholder="Your name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
            {!joined ? (
              <button className="btn primary md:col-span-1" onClick={joinRoom}>Join Room</button>
            ) : (
              <button className="btn danger md:col-span-1" onClick={leaveRoom}>Leave</button>
            )}
            <button className="btn md:col-span-1" onClick={toggleMute}>{muted ? 'Unmute Mic' : 'Mute Mic'}</button>
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="card p-4 md:col-span-2">
            <h2 className="text-lg mb-3">Participants</h2>
            <div className="space-y-3">
              {Object.entries(participants).map(([id, info]) => (
                <div key={id} className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full" style={{ background: id === selfId ? '#22d3ee' : '#94a3b8' }} />
                  <div className="flex-1">
                    <div className="text-sm opacity-90">{info.name}{id === selfId ? ' (You)' : ''}</div>
                    <div className="vu-bar mt-1"><div className="vu-level" style={{ width: `${info.level || 0}%` }} /></div>
                  </div>
                  <span className="badge">{id.slice(0,5)}</span>
                </div>
              ))}
              {Object.keys(participants).length === 0 && (
                <div className="text-sm text-slate-400">No participants yet.</div>
              )}
            </div>
          </div>

          <div className="card p-4">
            <h2 className="text-lg mb-3">Text Chat</h2>
            <div className="chat mb-3">
              {messages.map((m, idx) => (
                <div key={idx} className="msg">
                  <div><span className="from">{m.from?.name || 'Anon'}</span> <span className="time">{new Date(m.timestamp).toLocaleTimeString()}</span></div>
                  <div>{m.message}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input className="input flex-1" placeholder="Message..." value={msgText} onChange={(e) => setMsgText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' ? sendMessage() : null} />
              <button className="btn" onClick={sendMessage}>Send</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default App;
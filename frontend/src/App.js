import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

// Helper: build WS URL from REACT_APP_BACKEND_URL without hardcoding
function getBackendBase() {
  const raw = (import.meta?.env?.REACT_APP_BACKEND_URL || process.env.REACT_APP_BACKEND_URL || '').replace(/\/$/, '');
  if (!raw) return '';
  // Ensure '/api' prefix per ingress rules
  return raw.endsWith('/api') ? raw : `${raw}/api`;
}
function buildWsUrl() {
  const base = getBackendBase();
  if (!base) return '';
  const wsBase = base.startsWith('https') ? base.replace('https', 'wss') : base.replace('http', 'ws');
  return `${wsBase}/ws`;
}

const defaultIce = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }
];

// LocalStorage helpers per profile name
const profileKey = (name) => `vc_profile_${(name || '').trim()}`;
const saveProfile = (name, data) => {
  const key = profileKey(name);
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
};
const loadProfile = (name) => {
  const key = profileKey(name);
  try {
    const s = localStorage.getItem(key);
    if (s) return JSON.parse(s);
  } catch {}
  return null;
};

function App() {
  const [room, setRoom] = useState('demo');
  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [selfId, setSelfId] = useState(null);
  const [participants, setParticipants] = useState({}); // id -> {name, level}
  const [messages, setMessages] = useState([]);
  const [msgText, setMsgText] = useState('');
  const [muted, setMuted] = useState(false);
  const [iceServers, setIceServers] = useState(defaultIce);
  const [listenOnly, setListenOnly] = useState(false);

  // Audio settings state
  const [devices, setDevices] = useState({ inputs: [], outputs: [] });
  const [selectedMicId, setSelectedMicId] = useState('');
  const [selectedSpeakerId, setSelectedSpeakerId] = useState('');
  const [echoCancel, setEchoCancel] = useState(true);
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [autoGainControl, setAutoGainControl] = useState(true);
  const [micGain, setMicGain] = useState(100); // 0-100
  const [defaultRemoteVol, setDefaultRemoteVol] = useState(100); // 0-100
  const [peerVolumes, setPeerVolumes] = useState({}); // id -> 0-100

  const wsRef = useRef(null);
  const pcMapRef = useRef(new Map()); // peerId -> RTCPeerConnection
  const remoteAudioRefs = useRef(new Map()); // peerId -> HTMLAudioElement
  const localStreamRef = useRef(null); // raw mic
  const processedStreamRef = useRef(null); // after gain node
  const audioCtxRef = useRef(null);
  const gainNodeRef = useRef(null);
  const localAnalyserRef = useRef(null);
  const rafRef = useRef(null);

  const wsUrl = useMemo(() => buildWsUrl(), []);
  const backendBase = useMemo(() => getBackendBase(), []);

  useEffect(() => {
    // Try to fetch ICE servers from backend /api/ice (will return STUN only if TURN not set)
    const fetchIce = async () => {
      if (!backendBase) return;
      try {
        const res = await fetch(`${backendBase}/ice`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.iceServers)) setIceServers(data.iceServers);
        }
      } catch {}
    };
    fetchIce();
  }, [backendBase]);

  // Enumerate devices
  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const inputs = list.filter((d) => d.kind === 'audioinput');
      const outputs = list.filter((d) => d.kind === 'audiooutput');
      setDevices({ inputs, outputs });
    } catch {}
  }, []);

  useEffect(() => {
    refreshDevices();
    const handler = () => refreshDevices();
    navigator.mediaDevices.addEventListener?.('devicechange', handler);
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', handler);
  }, [refreshDevices]);

  // Load profile on name change (when not joined)
  useEffect(() => {
    if (!name || joined) return;
    const prof = loadProfile(name);
    if (prof) {
      setSelectedMicId(prof.selectedMicId || '');
      setSelectedSpeakerId(prof.selectedSpeakerId || '');
      setEchoCancel(typeof prof.echoCancel === 'boolean' ? prof.echoCancel : true);
      setNoiseSuppression(typeof prof.noiseSuppression === 'boolean' ? prof.noiseSuppression : true);
      setAutoGainControl(typeof prof.autoGainControl === 'boolean' ? prof.autoGainControl : true);
      setMicGain(typeof prof.micGain === 'number' ? prof.micGain : 100);
      setDefaultRemoteVol(typeof prof.defaultRemoteVol === 'number' ? prof.defaultRemoteVol : 100);
    }
  }, [name, joined]);

  const saveCurrentProfile = useCallback(() => {
    if (!name) return;
    saveProfile(name, {
      selectedMicId,
      selectedSpeakerId,
      echoCancel,
      noiseSuppression,
      autoGainControl,
      micGain,
      defaultRemoteVol,
    });
  }, [name, selectedMicId, selectedSpeakerId, echoCancel, noiseSuppression, autoGainControl, micGain, defaultRemoteVol]);

  const stopLevelsLoop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  };

  const startLocalMeter = (stream) => {
    try {
      const ctx = audioCtxRef.current || new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
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

  // Build processed stream with gain
  const buildProcessedStream = useCallback((rawStream) => {
    const ctx = audioCtxRef.current || new (window.AudioContext || window.webkitAudioContext)();
    audioCtxRef.current = ctx;
    const src = ctx.createMediaStreamSource(rawStream);
    const gainNode = gainNodeRef.current || ctx.createGain();
    gainNodeRef.current = gainNode;
    gainNode.gain.value = Math.max(0, Math.min(3, (micGain || 100) / 100)); // 0..3x
    const dest = ctx.createMediaStreamDestination();
    try { src.disconnect(); } catch {}
    src.connect(gainNode);
    gainNode.connect(dest);
    processedStreamRef.current = dest.stream;
    return dest.stream;
  }, [micGain]);

  // Apply selected speaker to all remote audios
  const applySpeakerSink = useCallback(() => {
    remoteAudioRefs.current.forEach((audio) => {
      if (audio && typeof audio.setSinkId === 'function' && selectedSpeakerId) {
        audio.setSinkId(selectedSpeakerId).catch(() => {});
      }
      // Apply default volume
      const pid = [...remoteAudioRefs.current.entries()].find(([_, a]) => a === audio)?.[0];
      const vol = (pid && peerVolumes[pid]) != null ? peerVolumes[pid] : defaultRemoteVol;
      audio.volume = Math.max(0, Math.min(1, (vol || 100) / 100));
    });
  }, [selectedSpeakerId, peerVolumes, defaultRemoteVol]);

  useEffect(() => {
    applySpeakerSink();
  }, [applySpeakerSink]);

  const createPeerConnection = useCallback((peerId, isOfferer) => {
    if (pcMapRef.current.has(peerId)) return pcMapRef.current.get(peerId);
    const pc = new RTCPeerConnection({ iceServers });
    pcMapRef.current.set(peerId, pc);

    const srcStream = processedStreamRef.current || localStreamRef.current;
    srcStream?.getTracks().forEach((t) => pc.addTrack(t, srcStream));

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
      // Set sink and volume
      if (typeof audio.setSinkId === 'function' && selectedSpeakerId) {
        audio.setSinkId(selectedSpeakerId).catch(() => {});
      }
      const vol = (peerVolumes[peerId] != null ? peerVolumes[peerId] : defaultRemoteVol);
      audio.volume = Math.max(0, Math.min(1, (vol || 100) / 100));
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
  }, [defaultRemoteVol, iceServers, peerVolumes, selectedSpeakerId, selfId]);

  const handleWsMessage = useCallback(async (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'joined') {
      setSelfId(msg.selfId);
      // Add self participant shell (show even in listen-only)
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

  const buildConstraints = useCallback(() => ({
    audio: {
      echoCancellation: !!echoCancel,
      noiseSuppression: !!noiseSuppression,
      autoGainControl: !!autoGainControl,
      sampleRate: 48000,
      channelCount: 1,
      ...(selectedMicId ? { deviceId: { exact: selectedMicId } } : {}),
    },
    video: false,
  }), [echoCancel, noiseSuppression, autoGainControl, selectedMicId]);

  const applyMicSettingsLive = useCallback(async () => {
    // Replace track on existing peer connections when settings change
    const src = processedStreamRef.current || localStreamRef.current;
    if (!src) return;
    const newTrack = (processedStreamRef.current || localStreamRef.current).getAudioTracks()[0];
    pcMapRef.current.forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
      if (sender && newTrack) {
        try { sender.replaceTrack(newTrack); } catch {}
      }
    });
  }, []);

  const joinRoom = useCallback(async () => {
    if (!wsUrl) {
      alert('Backend URL not configured. Please set REACT_APP_BACKEND_URL.');
      return;
    }
    let gotStream = false;
    try {
      const constraints = buildConstraints();
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      gotStream = true;
      localStreamRef.current = stream;
      // Build processed stream with gain and meter that stream
      const proc = buildProcessedStream(stream);
      startLocalMeter(proc);
    } catch (e) {
      // Listen-only fallback
      setListenOnly(true);
      console.warn('Mic denied or unavailable. Joining in listen-only mode.', e);
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', room, name: name || undefined }));
    };
    ws.onmessage = handleWsMessage;
    ws.onclose = () => {
      setJoined(false);
      if (gotStream && localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
        processedStreamRef.current = null;
      }
    };
    // Save settings for this name
    saveCurrentProfile();
  }, [buildConstraints, buildProcessedStream, handleWsMessage, name, room, wsUrl, saveCurrentProfile]);

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
    setListenOnly(false);
    stopLevelsLoop();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    processedStreamRef.current = null;
  }, []);

  const toggleMute = useCallback(() => {
    const src = processedStreamRef.current || localStreamRef.current;
    if (!src) return;
    const track = src.getAudioTracks()[0];
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

  // React to setting changes while joined
  useEffect(() => {
    if (!joined) return;
    // Update gain live
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = Math.max(0, Math.min(3, (micGain || 100) / 100));
      applyMicSettingsLive();
    }
  }, [micGain, joined, applyMicSettingsLive]);

  useEffect(() => {
    if (!joined) return;
    // Re-open mic with new constraints (echo/noise/AGC or device)
    (async () => {
      try {
        const constraints = buildConstraints();
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        localStreamRef.current = stream;
        const proc = buildProcessedStream(stream);
        // replace track
        applyMicSettingsLive();
        // restart meter on new processed stream
        stopLevelsLoop();
        startLocalMeter(proc);
      } catch (e) {
        console.warn('Failed to apply mic settings live', e);
      }
    })();
  }, [echoCancel, noiseSuppression, autoGainControl, selectedMicId, buildConstraints, buildProcessedStream, joined, applyMicSettingsLive]);

  // Update remote audio volumes when sliders change
  useEffect(() => {
    remoteAudioRefs.current.forEach((audio, pid) => {
      const vol = (peerVolumes[pid] != null ? peerVolumes[pid] : defaultRemoteVol);
      audio.volume = Math.max(0, Math.min(1, (vol || 100) / 100));
    });
  }, [peerVolumes, defaultRemoteVol]);

  useEffect(() => {
    return () => {
      leaveRoom();
    };
  }, [leaveRoom]);

  // UI helpers
  const setPeerVolume = (pid, value) => {
    const v = Math.max(0, Math.min(100, Number(value)));
    setPeerVolumes((prev) => ({ ...prev, [pid]: v }));
    const audio = remoteAudioRefs.current.get(pid);
    if (audio) audio.volume = Math.max(0, Math.min(1, v / 100));
  };

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Ultra-low-latency Voice + Chat</h1>
          <div className="badge">WebRTC + WS{listenOnly ? ' • Listen-only' : ''}</div>
        </header>

        {/* Controls */}
        <section className="card p-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <input className="input md:col-span-1" placeholder="Room name" value={room} onChange={(e) => setRoom(e.target.value)} />
            <input className="input md:col-span-1" placeholder="Your name (profile)" value={name} onChange={(e) => setName(e.target.value)} onBlur={saveCurrentProfile} />
            {!joined ? (
              <button className="btn primary md:col-span-1" onClick={joinRoom}>Join Room</button>
            ) : (
              <button className="btn danger md:col-span-1" onClick={leaveRoom}>Leave</button>
            )}
            <button className="btn md:col-span-1" onClick={toggleMute} disabled={listenOnly}>{muted ? 'Unmute Mic' : 'Mute Mic'}</button>
            <button className="btn md:col-span-1" onClick={saveCurrentProfile}>Save Settings</button>
          </div>
        </section>

        {/* Audio Settings */}
        <section className="card p-4">
          <h2 className="text-lg mb-3">Audio Settings</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="text-sm mb-1">Microphone</div>
              <select className="input w-full" value={selectedMicId} onChange={(e) => setSelectedMicId(e.target.value)}>
                <option value="">System default</option>
                {devices.inputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0,6)}`}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-sm mb-1">Speaker / Output {typeof document.createElement('audio').setSinkId === 'function' ? '' : '(not supported)'}</div>
              <select className="input w-full" value={selectedSpeakerId} onChange={(e) => setSelectedSpeakerId(e.target.value)} disabled={typeof document.createElement('audio').setSinkId !== 'function'}>
                <option value="">System default</option>
                {devices.outputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || `Out ${d.deviceId.slice(0,6)}`}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={echoCancel} onChange={(e) => setEchoCancel(e.target.checked)} /> Echo Cancellation</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={noiseSuppression} onChange={(e) => setNoiseSuppression(e.target.checked)} /> Noise Suppression</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={autoGainControl} onChange={(e) => setAutoGainControl(e.target.checked)} /> Auto Gain</label>
              </div>
              <div className="text-sm">Mic Gain: {micGain}</div>
              <input type="range" min="0" max="300" value={micGain} onChange={(e) => setMicGain(Number(e.target.value))} />
              <div className="text-sm">Default Remote Volume: {defaultRemoteVol}</div>
              <input type="range" min="0" max="100" value={defaultRemoteVol} onChange={(e) => setDefaultRemoteVol(Number(e.target.value))} />
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="card p-4 md:col-span-2">
            <h2 className="text-lg mb-3">Participants</h2>
            <div className="space-y-4">
              {Object.entries(participants).map(([id, info]) => (
                <div key={id} className="">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full" style={{ background: id === selfId ? '#22d3ee' : '#94a3b8' }} />
                    <div className="flex-1">
                      <div className="text-sm opacity-90">{info.name}{id === selfId ? ' (You)' : ''}</div>
                      <div className="vu-bar mt-1"><div className="vu-level" style={{ width: `${info.level || 0}%` }} /></div>
                    </div>
                    <span className="badge">{id.slice(0,5)}</span>
                  </div>
                  {id !== selfId && (
                    <div className="mt-2 flex items-center gap-3">
                      <div className="text-xs text-slate-300 w-28">Volume: {peerVolumes[id] != null ? peerVolumes[id] : defaultRemoteVol}</div>
                      <input type="range" min="0" max="100" value={peerVolumes[id] != null ? peerVolumes[id] : defaultRemoteVol} onChange={(e) => setPeerVolume(id, e.target.value)} className="flex-1" />
                    </div>
                  )}
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
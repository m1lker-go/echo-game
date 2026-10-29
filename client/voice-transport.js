// Spatial ECHO Voice; dormant until the authoritative ECHO server enables LiveKit.
(() => {
  'use strict';
  const FULL = 500, MAX = 800;
  let socket = null, enabled = false, room = null, lk = null, loading = null;
  let connectionSerial = 0, speakingSerial = 0, scope = null;
  let positions = new Map(), selfPosition = null, publishingTrack = null;
  let context = null;
  const attached = new Map(), talking = new Set();

  const inGame = () => !document.hidden && document.querySelector('#main-menu')?.classList.contains('is-hidden') === true;
  const voiceScope = () => window.ECHOVoiceUI?.getScope?.();
  const sameScope = (a,b) => a && b && String(a.roundId) === String(b.roundId) && String(a.roomId) === String(b.roomId);
  const connected = () => !!(room && lk && room.state === lk.ConnectionState.Connected);
  const distance = id => {
    const pos = positions.get(id);
    return pos && selfPosition ? Math.hypot(pos.x - selfPosition.x, pos.y - selfPosition.y) : Infinity;
  };
  const volume = d => d <= FULL ? 1 : d >= MAX ? 0 : (MAX - d) / (MAX - FULL);
  const isMuted = id => window.ECHOVoiceUI?.isMuted?.(id) === true;

  function library() {
    if (window.LivekitClient) return Promise.resolve(window.LivekitClient);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = './vendor/livekit-client-2.23.0.min.js';
      script.async = true;
      script.onload = () => window.LivekitClient ? resolve(window.LivekitClient) : reject(new Error('Missing LiveKit SDK'));
      script.onerror = () => reject(new Error('LiveKit SDK did not load'));
      document.head.append(script);
    }).catch(error => { loading = null; throw error; });
    return loading;
  }
  function speaker(id, active) {
    if (!scope || !positions.has(id)) return;
    if (active) talking.add(id); else talking.delete(id);
    document.dispatchEvent(new CustomEvent('echo:voice-speaking', {detail: {
      id, active, name: positions.get(id).name,
      roomId: scope.roomId, roundId: scope.roundId
    }}));
  }
  function removeTrack(id) {
    const a = attached.get(id);
    if (!a) return;
    attached.delete(id);
    try { a.source?.disconnect(); a.gain?.disconnect(); } catch (_) {}
    try { a.track.detach(a.element); } catch (_) {}
    a.element.pause();
    a.element.remove();
  }
  function receivedTrack(track, publication, participant) {
    if (track.kind !== 'audio') return;
    const id = participant.identity;
    removeTrack(id);
    const element = track.attach();
    element.playsInline = true;
    element.autoplay = true;
    element.style.display = 'none';
    document.body.append(element);
    const a = {track, element, source:null, gain:null};
    attached.set(id,a);
    try {
      const AudioContextType = window.AudioContext || window.webkitAudioContext;
      if (AudioContextType) {
        context ||= new AudioContextType();
        a.source = context.createMediaElementSource(element);
        a.gain = context.createGain();
        a.source.connect(a.gain);
        a.gain.connect(context.destination);
      }
    } catch (_) { /* Use HTMLMediaElement volume as a fallback. */ }
    refreshAudio();
    void element.play().catch(() => {});
  }
  function refreshAudio() {
    if (!connected()) return;
    for (const participant of room.remoteParticipants.values()) {
      const id = participant.identity, d = distance(id), wanted = d < MAX && !isMuted(id);
      for (const publication of participant.trackPublications.values()) {
        if (publication.kind === 'audio' && publication.isSubscribed !== wanted) publication.setSubscribed(wanted);
      }
      const a = attached.get(id);
      if (a) {
        const gain = wanted ? volume(d) : 0;
        if (a.gain) a.gain.gain.setTargetAtTime(gain, context.currentTime, 0.07);
        else a.element.volume = gain;
      }
      if (!wanted && talking.has(id)) speaker(id,false);
    }
  }
  function onSpeaking(participants) {
    const current = new Set(participants.filter(p => p.identity !== socket?.id &&
      distance(p.identity) < MAX && !isMuted(p.identity)).map(p => p.identity));
    for (const id of [...talking]) if (!current.has(id)) speaker(id,false);
    for (const id of current) if (!talking.has(id)) speaker(id,true);
  }
  function disconnectVoice() {
    ++connectionSerial;
    ++speakingSerial;
    if (publishingTrack) publishingTrack.enabled = false;
    publishingTrack = null;
    for (const id of [...talking]) speaker(id,false);
    talking.clear();
    for (const id of [...attached.keys()]) removeTrack(id);
    const old = room;
    room = null;
    scope = null;
    positions.clear();
    selfPosition = null;
    if (old) void old.disconnect();
  }
  async function enterVoice() {
    if (!enabled || !socket?.connected || !inGame()) return;
    const newScope = voiceScope();
    if (newScope?.roundId == null || newScope?.roomId == null) return;
    if (sameScope(scope,newScope) && room) return;
    disconnectVoice();
    const ticket = connectionSerial;
    scope = {roomId:String(newScope.roomId),roundId:String(newScope.roundId)};
    try {
      const response = await new Promise((resolve, reject) =>
        socket.timeout(7000).emit('echo:voice:join', null, (error,data) => error ? reject(error) : resolve(data)));
      if (ticket !== connectionSerial || !inGame()) return;
      if (!response?.ok || !sameScope(scope,response)) throw new Error(response?.error || 'Wrong voice room');
      lk = await library();
      if (ticket !== connectionSerial || !inGame()) return;
      const joined = new lk.Room({adaptiveStream:false,dynacast:false});
      room = joined;
      joined.on(lk.RoomEvent.TrackSubscribed, receivedTrack);
      joined.on(lk.RoomEvent.TrackUnsubscribed, (_track,_publication,participant) => removeTrack(participant.identity));
      joined.on(lk.RoomEvent.ParticipantDisconnected, participant => {
        removeTrack(participant.identity);
        if (talking.has(participant.identity)) speaker(participant.identity,false);
      });
      joined.on(lk.RoomEvent.TrackPublished, refreshAudio);
      joined.on(lk.RoomEvent.ActiveSpeakersChanged, onSpeaking);
      joined.on(lk.RoomEvent.Disconnected, () => { if (room === joined) disconnectVoice(); });
      await joined.connect(response.url,response.token,{autoSubscribe:false});
      if (ticket !== connectionSerial || !inGame()) { void joined.disconnect(); return; }
      refreshAudio();
    } catch (error) {
      if (ticket === connectionSerial) {
        console.warn('[ECHO Voice] Not connected:',error.message);
        disconnectVoice();
      }
    }
  }
  function availability(data) {
    enabled = data?.enabled === true;
    if (!enabled) disconnectVoice();
    else void enterVoice();
  }
  function onRoom(data) {
    if (!data?.round || data.roomId == null) return;
    const incoming = {roundId:data.round.id,roomId:data.roomId};
    if (scope && !sameScope(scope,incoming)) disconnectVoice();
    queueMicrotask(() => { void enterVoice(); });
  }
  function onPlayers(players) {
    if (!Array.isArray(players)) return;
    const next = new Map();
    let own = null;
    for (const p of players) {
      if (!p || typeof p.id !== 'string' || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const position = {x:p.x,y:p.y,name:String(p.name || 'Player').slice(0,60)};
      if (p.id === socket?.id) own = position;
      else next.set(p.id,position);
    }
    positions = next;
    selfPosition = own;
    refreshAudio();
  }
  function bindSocket(next) {
    if (!next || socket === next) return;
    if (socket) {
      socket.off('echo:voice:availability',availability);
      socket.off('echo:room',onRoom);
      socket.off('echo:players',onPlayers);
      socket.off('disconnect',disconnectVoice);
    }
    disconnectVoice();
    socket = next;
    enabled = false;
    socket.on('echo:voice:availability',availability);
    socket.on('echo:room',onRoom);
    socket.on('echo:players',onPlayers);
    socket.on('disconnect',disconnectVoice);
    if (socket.connected) socket.emit('echo:hello',{version:1});
  }

  window.ECHOVoiceTransport = Object.freeze({
    get ready() { return connected() && inGame(); },
    async start(stream) {
      if (!connected() || !inGame()) throw new Error('Voice connection unavailable');
      const track = stream.getAudioTracks?.()[0], currentRoom = room;
      if (!track || track.readyState === 'ended') throw new Error('Microphone unavailable');
      const ticket = ++speakingSerial;
      publishingTrack = track;
      await currentRoom.localParticipant.publishTrack(track,{source:lk.Track.Source.Microphone});
      if (ticket !== speakingSerial || !inGame() || currentRoom !== room) {
        track.enabled = false;
        await currentRoom.localParticipant.unpublishTrack(track,false).catch(() => {});
        return;
      }
      void context?.resume?.().catch(() => {});
      void currentRoom.startAudio?.().catch(() => {});
    },
    stop() {
      ++speakingSerial;
      const track = publishingTrack;
      publishingTrack = null;
      if (!track) return;
      track.enabled = false;
      if (room) void room.localParticipant.unpublishTrack(track,false).catch(() => {});
    }
  });
  document.addEventListener('echo:socket-ready',event => bindSocket(event.detail?.socket || window.echoSocket));
  document.addEventListener('echo:returned-to-menu',disconnectVoice);
  document.addEventListener('echo:game-started',() => queueMicrotask(() => { void enterVoice(); }));
  document.addEventListener('echo:voice-mute-changed',refreshAudio);
  document.addEventListener('visibilitychange',() => document.hidden ? disconnectVoice() : void enterVoice());
  window.addEventListener('blur',disconnectVoice);
  window.addEventListener('pointerdown',() => { void context?.resume?.().catch(() => {}); },{passive:true});
  setInterval(refreshAudio,450);
  bindSocket(window.echoSocket);
})();

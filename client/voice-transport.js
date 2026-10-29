// Spatial ECHO Voice; dormant until the authoritative ECHO server enables LiveKit.
(() => {
  'use strict';
  const FULL = 500, MAX = 800;
  let socket = null, enabled = false, room = null, lk = null, loading = null;
  let connectionSerial = 0, speakingSerial = 0, scope = null;
  let positions = new Map(), selfPosition = null, publishingTrack = null;
  let context = null, refreshTimer = null;
  let roomSnapshot = null, joining = false, retryTimer = null, retryDelay = 1800;
  let availabilityReceived = false, statusCode = 'WAIT_SERVER';
  const attached = new Map(), talking = new Set(), subscriptionStates = new Map();

  const inGame = () => !document.hidden && document.querySelector('#main-menu')?.classList.contains('is-hidden') === true;
  const voiceScope = () => roomSnapshot;
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
    const transmittingNearby = new Set();
    for (const participant of room.remoteParticipants.values()) {
      const id = participant.identity, d = distance(id), wanted = d < MAX && !isMuted(id);
      // Push-to-talk has a published audio track while the microphone is held.
      // VAD can miss brief speech, so use real LiveKit publications for the roster.
      // Muting locally must not hide the control needed to unmute someone.
      const microphonePublications = [...participant.trackPublications.values()]
        .filter(publication => publication.kind === 'audio');
      if (d < MAX && positions.has(id) &&
          microphonePublications.some(publication => !publication.isMuted)) {
        transmittingNearby.add(id);
      }
      for (const publication of microphonePublications) {
        const key = id + ':' + publication.trackSid;
        if (subscriptionStates.get(key) !== wanted) {
          subscriptionStates.set(key, wanted);
          publication.setSubscribed(wanted);
        }
      }
      const a = attached.get(id);
      if (a) {
        const gain = wanted ? volume(d) : 0;
        if (a.gain) a.gain.gain.setTargetAtTime(gain, context.currentTime, 0.07);
        else a.element.volume = gain;
      }
    }
    for (const id of [...talking]) if (!transmittingNearby.has(id)) speaker(id,false);
    for (const id of transmittingNearby) if (!talking.has(id)) speaker(id,true);
  }
  function onSpeaking() { refreshAudio(); }
  function scheduleRetry() {
    if (retryTimer !== null || !enabled || !socket?.connected || !inGame()) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void enterVoice();
    }, retryDelay);
    retryDelay = Math.min(12000, Math.round(retryDelay * 1.7));
  }
  function disconnectVoice() {
    if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
    joining = false;
    ++connectionSerial;
    ++speakingSerial;
    if (publishingTrack) publishingTrack.enabled = false;
    publishingTrack = null;
    for (const id of [...talking]) speaker(id,false);
    talking.clear();
    for (const id of [...attached.keys()]) removeTrack(id);
    subscriptionStates.clear();
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
    if (joining || (sameScope(scope,newScope) && connected())) return;
    disconnectVoice();
    joining = true;
    statusCode = 'JOINING';
    const ticket = connectionSerial;
    scope = {roomId:String(newScope.roomId),roundId:String(newScope.roundId)};
    try {
      const response = await new Promise((resolve, reject) =>
        socket.timeout(7000).emit('echo:voice:join', null, (error,data) => error ? reject(error) : resolve(data)));
      if (ticket !== connectionSerial || !inGame()) return;
      if (!response?.ok || !sameScope(scope,response)) {
        statusCode = response?.error === 'rate_limited' ? 'RATE_LIMIT' :
          response?.error === 'not_playing' ? 'NOT_PLAYING' :
          response?.error === 'disabled' ? 'DISABLED' : 'JOIN_DENIED';
        throw new Error(response?.error || 'Wrong voice room');
      }
      statusCode = 'SDK';
      lk = await library();
      if (ticket !== connectionSerial || !inGame()) return;
      statusCode = 'SIGNAL';
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
      joined.on(lk.RoomEvent.Disconnected, () => {
        if (room === joined) { statusCode = 'DISCONNECTED'; disconnectVoice(); scheduleRetry(); }
      });
      await joined.connect(response.url,response.token,{autoSubscribe:false});
      if (ticket !== connectionSerial || !inGame()) { void joined.disconnect(); return; }
      joining = false;
      retryDelay = 1800;
      statusCode = 'READY';
      refreshAudio();
    } catch (error) {
      if (ticket === connectionSerial) {
        if (statusCode === 'JOINING') statusCode = 'JOIN_ERROR';
        else if (statusCode === 'SDK') statusCode = 'SDK_ERROR';
        else if (statusCode === 'SIGNAL') statusCode = 'LIVEKIT_ERROR';
        console.warn('[ECHO Voice] Not connected:',error.message);
        disconnectVoice();
        scheduleRetry();
      }
    }
  }
  function availability(data) {
    availabilityReceived = true;
    enabled = data?.enabled === true;
    if (!enabled) {
      if (refreshTimer !== null) { clearInterval(refreshTimer); refreshTimer = null; }
      disconnectVoice();
    } else {
      if (refreshTimer === null) refreshTimer = setInterval(refreshAudio, 450);
      void enterVoice();
    }
  }
  function onRoom(data) {
    if (!data?.round || data.roomId == null) return;
    const incoming = {roundId:data.round.id,roomId:data.roomId};
    roomSnapshot = incoming;
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
    // The 450ms update batches subscription and gain changes, not each game frame.
  }
  function socketDisconnected() {
    roomSnapshot = null;
    statusCode = 'SOCKET';
    disconnectVoice();
  }
  function bindSocket(next) {
    if (!next || socket === next) return;
    if (socket) {
      socket.off('echo:voice:availability',availability);
      socket.off('echo:room',onRoom);
      socket.off('echo:players',onPlayers);
      socket.off('disconnect',socketDisconnected);
    }
    disconnectVoice();
    socket = next;
    enabled = false;
    availabilityReceived = false;
    roomSnapshot = null;
    statusCode = 'WAIT_SERVER';
    retryDelay = 1800;
    socket.on('echo:voice:availability',availability);
    socket.on('echo:room',onRoom);
    socket.on('echo:players',onPlayers);
    socket.on('disconnect',socketDisconnected);
    if (socket.connected) socket.emit('echo:hello',{version:1});
  }

  window.ECHOVoiceTransport = Object.freeze({
    get ready() { return connected() && inGame(); },
    get status() {
      if (!socket?.connected) return 'SOCKET';
      if (!inGame()) return 'MENU';
      if (!availabilityReceived) return 'WAIT_SERVER';
      if (!enabled) return 'DISABLED';
      if (!roomSnapshot) return 'ROOM';
      if (joining) return 'CONNECTING';
      return connected() ? 'READY' : statusCode;
    },
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
  document.addEventListener('echo:returned-to-menu',() => { roomSnapshot = null; disconnectVoice(); });
  document.addEventListener('echo:game-started',() => queueMicrotask(() => { void enterVoice(); }));
  document.addEventListener('echo:voice-mute-changed',refreshAudio);
  document.addEventListener('visibilitychange',() => document.hidden ? disconnectVoice() : void enterVoice());
  window.addEventListener('blur',disconnectVoice);
  window.addEventListener('focus',() => { void enterVoice(); });
  window.addEventListener('pointerdown',() => { void context?.resume?.().catch(() => {}); },{passive:true});
  bindSocket(window.echoSocket);
})();

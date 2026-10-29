// ECHO Voice HUD (stage 1). Real voice transport will supply speaking events and start/stop.
// No audio is transmitted until an authenticated window.ECHOVoiceTransport is installed.
(() => {
  'use strict';
  const mic = document.querySelector('#echo-voice-mic');
  const panel = document.querySelector('#echo-voice-speakers');
  const speakerList = document.querySelector('#echo-voice-speakers-list');
  if (!mic || !panel || !speakerList) return;

  const STORAGE_KEY = 'echo.voice.round-mutes.v1';
  const SPEAKER_LINGER_MS = 3000;
  const muted = new Set();
  const speakers = new Map();
  let roomId = null;
  let roundId = null;
  let boundSocket = null;
  let pointerId = null;
  let pressed = false;
  let generation = 0;
  let stream = null;
  let transmitting = false;

  const english = () => document.documentElement.lang?.startsWith('en');
  const label = (ru, en) => english() ? en : ru;
  const activeGame = () => document.querySelector('#main-menu')?.classList.contains('is-hidden') === true;
  const scopeKey = () => roundId !== null && roomId !== null ? roundId + ':' + roomId : null;

  function saveMutes() {
    try {
      if (scopeKey()) sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ scope: scopeKey(), ids: [...muted] }));
    } catch (_) { /* Storage can be disabled in embedded browsers. */ }
  }
  function loadMutes() {
    muted.clear();
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
      if (saved?.scope !== scopeKey() || !Array.isArray(saved.ids)) return;
      for (const id of saved.ids.slice(0, 100)) if (typeof id === 'string' && id.length <= 150) muted.add(id);
    } catch (_) {}
  }
  function svgMicrophone() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const capsule = document.createElementNS(ns, 'rect');
    capsule.setAttribute('x', '9'); capsule.setAttribute('y', '2');
    capsule.setAttribute('width', '6'); capsule.setAttribute('height', '13');
    capsule.setAttribute('rx', '3');
    const waves = document.createElementNS(ns, 'path');
    waves.setAttribute('d', 'M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8');
    svg.append(capsule, waves);
    return svg;
  }
  function svgMute(isMuted) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', isMuted ?
      'M11 5 6 9H3v6h3l5 4v-7M17 9l5 6m0-6-5 6M3 3l18 18' :
      'M11 5 6 9H3v6h3l5 4V5Zm5 4a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12');
    svg.append(path);
    return svg;
  }
  function notifyMute(id) {
    document.dispatchEvent(new CustomEvent('echo:voice-mute-changed', { detail: {
      id, muted: muted.has(id), roomId, roundId
    } }));
  }
  function renderSpeakers() {
    const now = Date.now();
    for (const [id, speaker] of speakers) if (speaker.expiresAt && speaker.expiresAt <= now) speakers.delete(id);
    speakerList.replaceChildren();
    const visible = [...speakers.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
    panel.hidden = visible.length === 0;
    for (const speaker of visible) {
      const isMuted = muted.has(speaker.id);
      const row = document.createElement('div');
      row.className = 'echo-voice-speaker' + (isMuted ? ' is-muted' : '') +
        (speaker.expiresAt ? ' is-idle' : ' is-speaking');
      const indicator = document.createElement('span');
      indicator.className = 'echo-voice-speaker-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      indicator.append(svgMicrophone());
      const name = document.createElement('span');
      name.className = 'echo-voice-speaker-name';
      name.textContent = speaker.name;
      name.title = speaker.name;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'echo-voice-mute';
      button.setAttribute('aria-pressed', String(isMuted));
      button.setAttribute('aria-label', (isMuted ? label('Включить звук: ', 'Unmute: ') : label('Заглушить: ', 'Mute: ')) + speaker.name);
      button.append(svgMute(isMuted));
      button.addEventListener('click', () => {
        if (muted.has(speaker.id)) muted.delete(speaker.id);
        else muted.add(speaker.id);
        saveMutes();
        notifyMute(speaker.id);
        renderSpeakers();
      });
      row.append(indicator, name, button);
      speakerList.append(row);
    }
  }
  function onRoom(data) {
    if (data?.round?.id == null || data?.roomId == null) return;
    const nextRound = String(data.round.id);
    const nextRoom = String(data.roomId);
    if (nextRound === roundId && nextRoom === roomId) return;
    endHold();
    roundId = nextRound;
    roomId = nextRoom;
    speakers.clear();
    loadMutes();
    renderSpeakers();
  }
  function onDisconnect() {
    endHold();
    speakers.clear();
    renderSpeakers();
  }
  function bindSocket(socket) {
    if (!socket || socket === boundSocket) return;
    if (boundSocket) {
      boundSocket.off('echo:room', onRoom);
      boundSocket.off('disconnect', onDisconnect);
    }
    boundSocket = socket;
    socket.on('echo:room', onRoom);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) socket.emit('echo:hello', { version: 1 });
  }
  // Only the actual voice transport should send this event; do not synthesize speaker names.
  function onSpeaking(event) {
    const data = event.detail;
    if (!data || data.roomId == null || data.roundId == null ||
        String(data.roomId) !== roomId || String(data.roundId) !== roundId) return;
    if (typeof data.id !== 'string' || !data.id || data.id.length > 150 ||
        typeof data.name !== 'string' || !data.name.trim()) return;
    if (data.active === true) {
      speakers.set(data.id, { id: data.id, name: data.name.trim().slice(0, 60),
        updatedAt: Date.now(), expiresAt: 0 });
    } else if (speakers.has(data.id)) {
      speakers.get(data.id).expiresAt = Date.now() + SPEAKER_LINGER_MS;
    }
    renderSpeakers();
  }

  function feedback(text) { window.ECHOToast?.show(text); }
  function unavailableFeedback() {
    const status = String(window.ECHOVoiceTransport?.status || 'LOADING').replace(/[^A-Z_]/g, '').slice(0, 28);
    feedback(label('Голосовой чат пока не подключён', 'Voice chat is not connected yet') + ' [' + status + ']');
  }
  function stopTracks(value) { for (const track of value?.getTracks?.() || []) track.stop(); }
  function updateMic() {
    mic.classList.toggle('is-pressed', pressed);
    mic.classList.toggle('is-transmitting', transmitting);
    mic.setAttribute('aria-pressed', String(transmitting));
  }
  function endHold() {
    pressed = false;
    generation++;
    pointerId = null;
    transmitting = false;
    if (stream) { stopTracks(stream); stream = null; }
    try { window.ECHOVoiceTransport?.stop?.(); } catch (_) {}
    updateMic();
  }
  async function beginHold() {
    if (pressed || !activeGame()) return;
    const transport = window.ECHOVoiceTransport;
    if (!transport?.ready) {
      unavailableFeedback();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      feedback(label('Микрофон недоступен на этом устройстве', 'Microphone unavailable on this device'));
      return;
    }
    pressed = true;
    const ticket = ++generation;
    updateMic();
    let captured = null;
    try {
      captured = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
      });
      // Permission may complete after a finger was released or a round changed.
      if (!pressed || ticket !== generation || !activeGame() || !transport.ready) {
        stopTracks(captured);
        return;
      }
      stream = captured;
      await transport.start(captured);
      if (!pressed || ticket !== generation || !activeGame()) {
        try { transport.stop?.(); } catch (_) {}
        stopTracks(captured);
        if (stream === captured) stream = null;
        return;
      }
      transmitting = true;
      updateMic();
    } catch (error) {
      stopTracks(captured);
      if (stream === captured) stream = null;
      if (ticket === generation) {
        endHold();
        feedback(label('Не удалось включить микрофон', 'Could not activate microphone'));
      }
    }
  }

  mic.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (pointerId !== null) return;
    // No pointer capture if voice service is not connected.
    if (!window.ECHOVoiceTransport?.ready) {
      unavailableFeedback();
      return;
    }
    pointerId = event.pointerId;
    try { mic.setPointerCapture(event.pointerId); } catch (_) {}
    event.preventDefault();
    void beginHold();
  });
  const releasePointer = (event) => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    endHold();
  };
  mic.addEventListener('pointerup', releasePointer);
  mic.addEventListener('pointercancel', releasePointer);
  mic.addEventListener('lostpointercapture', releasePointer);
  mic.addEventListener('contextmenu', event => event.preventDefault());
  // Desktop push-to-talk. Ignore text editing and key autorepeat.
  window.addEventListener('keydown', event => {
    if (event.code !== 'KeyV' || event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || '') ||
        event.target?.isContentEditable) return;
    if (pressed || pointerId !== null) return;
    if (!window.ECHOVoiceTransport?.ready) return;
    event.preventDefault();
    void beginHold();
  });
  window.addEventListener('keyup', event => { if (event.code === 'KeyV' && pointerId === null) endHold(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) endHold(); });
  window.addEventListener('blur', endHold);
  document.addEventListener('echo:returned-to-menu', () => { endHold(); speakers.clear(); renderSpeakers(); });
  document.addEventListener('echo:socket-ready', event => bindSocket(event.detail?.socket || window.echoSocket));
  document.addEventListener('echo:voice-speaking', onSpeaking);
  window.addEventListener('languagechange', renderSpeakers);

  // Future transport contract: {ready:true,start(MediaStream):Promise,stop():void}.
  // Muting is per listener, per room and per 15-minute round (not a permanent block).
  window.ECHOVoiceUI = Object.freeze({
    isMuted: id => muted.has(id),
    getScope: () => ({ roomId, roundId })
  });
  setInterval(() => {
    // Keep the speaker/mute list attached when gameplay replaces its socket.
    if (window.echoSocket && window.echoSocket !== boundSocket) bindSocket(window.echoSocket);
    if ([...speakers.values()].some(speaker => speaker.expiresAt)) renderSpeakers();
  }, 500);
  bindSocket(window.echoSocket);
  renderSpeakers();
  updateMic();
})();

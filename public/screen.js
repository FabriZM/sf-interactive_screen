/* The display page. Pure renderer: the server owns the state, this draws it. */

// ---- Copy you may want to retype between takes -------------------------
const TEXT = {
  sequence: 'Sequence 01',
  monitorTC: '00:04:18:07',
  bins: ['ANTI_scene04', 'A001_C012_0714X8', 'A001_C013_0714X8', 'ROOM_TONE_02', 'score_v3.wav'],
};
// ------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
let state = structuredClone(DEFAULT_STATE);

// ---------------------------------------------------------- fake Premiere

function buildFakeUI() {
  const clip = (cls, w, label) =>
    `<div class="pui-clip ${cls}" style="width:${w}px">${label}</div>`;
  const gap = (w) => `<div class="pui-gap" style="width:${w}px"></div>`;

  const lane = (cls, parts) =>
    parts.map(([w, label]) => (label ? clip(cls, w, label) : gap(w))).join('');

  const track = (name, laneHTML) => `
    <div class="pui-track">
      <div class="pui-track-head"><i class="btn"></i><i class="btn"></i><span>${name}</span></div>
      <div class="pui-lane">${laneHTML}</div>
    </div>`;

  $('bg-fake').innerHTML = `
  <div class="pui">
    <div class="pui-tabs">
      <span>Home</span><span>Import</span><span class="on">Edit</span><span>Export</span>
      <span class="spacer"></span>
      <span class="chip">Editing</span><span>Color</span><span>Effects</span><span>Audio</span>
    </div>
    <div class="pui-main">
      <div class="pui-col pui-left">
        <div class="pui-panel" style="flex:1">
          <header><span class="on">Project: ANTI</span><span>Effects</span></header>
          <div class="pui-list">
            ${TEXT.bins
              .map(
                (n, i) =>
                  `<div class="pui-item ${i === 1 ? 'sel' : ''}">
                     <i class="sw" style="background:${i > 2 ? '#3f7a5c' : '#4a5a91'}"></i>${n}
                   </div>`
              )
              .join('')}
          </div>
        </div>
        <div class="pui-panel" style="height:34%">
          <header><span class="on">Effect Controls</span></header>
          <div class="pui-list">
            <div class="pui-item">Motion</div>
            <div class="pui-item">Opacity</div>
            <div class="pui-item">Lumetri Color</div>
            <div class="pui-item">Time Remapping</div>
          </div>
        </div>
      </div>

      <div class="pui-col pui-mid">
        <div class="pui-monitors">
          <div class="pui-panel">
            <header><span class="on">Source: A001_C012</span><span>Audio Clip Mixer</span></header>
            <div class="pui-screen"><div class="pui-tc">00:01:52:14</div></div>
            <div class="pui-transport">◀◀  ◀  ▶  ▶▶  ⟲</div>
          </div>
          <div class="pui-panel">
            <header><span class="on">Program: ${TEXT.sequence}</span></header>
            <div class="pui-screen"><div class="pui-tc">${TEXT.monitorTC}</div></div>
            <div class="pui-transport">◀◀  ◀  ▶  ▶▶  ⟲</div>
          </div>
        </div>

        <div class="pui-panel pui-timeline">
          <header><span class="on">${TEXT.sequence}</span></header>
          <div class="pui-ruler"><div class="pui-playhead"></div></div>
          <div class="pui-tracks">
            ${track('V2', lane('v2', [[150, ''], [96, 'title_card'], [40, ''], [128, 'lower_third']]))}
            ${track('V1', lane('v', [[0, ''], [188, 'A001_C011'], [4, ''], [232, 'A001_C012'], [4, ''], [166, 'A001_C013'], [4, ''], [140, 'A001_C014'], [4, ''], [96, 'INSERT_hand']]))}
            ${track('A1', lane('a', [[0, ''], [188, 'A001_C011'], [4, ''], [232, 'A001_C012'], [4, ''], [166, 'A001_C013'], [4, ''], [140, 'A001_C014']]))}
            ${track('A2', lane('a', [[64, ''], [420, 'ROOM_TONE_02'], [22, ''], [260, 'score_v3']]))}
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ time

const pad = (n) => String(Math.floor(n)).padStart(2, '0');

function hms(totalSecs) {
  if (!isFinite(totalSecs) || totalSecs < 0) return '--:--:--';
  return `${pad(totalSecs / 3600)}:${pad((totalSecs % 3600) / 60)}:${pad(totalSecs % 60)}`;
}

// --------------------------------------------------------------- cursor

// The pointer stays visible while there's a picture, and disappears only once
// the screen has actually gone dark — hiding it the instant a 1.4s fade
// *starts* would make it pop out while the image is still on camera.
let cursorTimer = null;
let cursorWasBlack = false;

function applyCursor() {
  if (state.black.on === cursorWasBlack) return;   // only act on transitions
  cursorWasBlack = state.black.on;
  clearTimeout(cursorTimer);

  if (state.black.on) {
    cursorTimer = setTimeout(
      () => document.body.classList.add('nocursor'),
      state.black.fadeMs
    );
  } else {
    document.body.classList.remove('nocursor');   // waking brings it straight back
  }
}

// ---------------------------------------------------------------- render

// Everything that only changes when a new state arrives. Kept out of the
// per-frame path: rewriting transition-duration every frame cancels and
// restarts the CSS transition, so the fade to black never progresses.
function applyState() {
  const r = state.render;

  $('encode').classList.toggle('on', r.visible);
  $('pr-file').textContent = r.filename;
  $('pr-source').textContent = TEXT.sequence;

  document.body.dataset.bg = state.bg;
  document.body.dataset.menubar = state.menubar ? '1' : '0';
  document.body.dataset.gi = String(state.glitch.intensity);

  $('batt-banner').classList.toggle('on', state.battery === 'banner');
  $('batt-modal-wrap').classList.toggle('on', state.battery === 'modal');

  const black = $('black');
  black.style.transitionDuration = state.black.fadeMs + 'ms';
  black.classList.toggle('on', state.black.on);
  applyCursor();

  wakeTravel = 0;   // a fresh blackout starts the wake gesture over
  lastPointer = null;

  clock();
}

// Per-frame: only the numbers that move continuously.
function draw() {
  const now = Date.now();
  const r = state.render;
  // What's on camera is the warped/capped display value, not the smooth
  // internal one — see displayPct() in shared.js for why.
  const pct = displayPct(r, now);

  $('pr-fill').style.width = pct.toFixed(2) + '%';
  $('pr-pct').textContent = pct.toFixed(0) + '%';
  $('pr-preview-pct').textContent = pct.toFixed(0) + '%';

  const elapsed = currentElapsedMs(r, now) / 1000;
  $('pr-elapsed').textContent = hms(elapsed);

  // ETA. When stalled the bar is frozen but time keeps passing, so the
  // estimate is recomputed from the *observed* average rate — it climbs,
  // which is exactly what a dying machine looks like.
  let eta;
  if (r.stalled) {
    const observed = elapsed > 0 ? (pct - 0) / elapsed : 0;
    eta = observed > 0.0001 ? (100 - pct) / observed : Infinity;
  } else if (r.paused || r.rate <= 0) {
    eta = null;
  } else {
    eta = (100 - pct) / r.rate;
  }
  $('pr-eta').textContent =
    pct >= 98.5   // pct asymptotes toward 99 and never reaches 100 — see displayPct()
      ? 'Finalizing…'
      : eta === null
        ? 'Estimated Time Remaining: --:--:--'
        : `Estimated Time Remaining: ${eta > 359999 ? '--:--:--' : hms(eta)}`;

  // menu-bar battery
  const batt = currentBattery(state.power, now);
  $('mb-batt-pct').textContent = Math.round(batt) + '%';
  $('mb-batt-fill').style.width = Math.max(3, batt) + '%';
  document.body.dataset.batt = batt < 20 || state.battery !== 'none' ? 'low' : 'ok';

  // glitch — classList.toggle is a no-op when the value is unchanged, so the
  // CSS animations are never restarted by this per-frame call
  document.body.classList.toggle('glitching', glitchActive(state.glitch, now));

  // Dead battery only makes sense over a black screen; restoring the picture
  // mid-flash hides it, same as a machine coming back to life would.
  $('deadbatt').classList.toggle('on', state.black.on && now < state.dead.untilMs);
}

function tick() {
  draw();
  requestAnimationFrame(tick);
}

// ----------------------------------------------------------------- clock

function clock() {
  const d = new Date(currentClock(state.clock));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const h = d.getHours() % 12 || 12;
  const ampm = d.getHours() < 12 ? 'AM' : 'PM';
  $('mb-clock').textContent =
    `${days[d.getDay()]} ${mons[d.getMonth()]} ${d.getDate()}  ${h}:${pad(d.getMinutes())} ${ampm}`;
}

// ------------------------------------------------------------------- net

function send(payload) {
  return fetch('/cmd', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

function connect() {
  const es = new EventSource('/events');
  es.onmessage = (e) => {
    state = JSON.parse(e.data);
    $('dot').classList.remove('show');
    applyState();
    draw();
  };
  es.onerror = () => $('dot').classList.add('show'); // EventSource retries itself
}

// ------------------------------------------------- background screenshot

const LS_KEY = 'detour.screenshot';

function useImage(dataURL) {
  $('bg-img').src = dataURL;
  send({ cmd: 'bg', bg: 'image' });
}

function loadStoredImage() {
  const stored = localStorage.getItem(LS_KEY);
  if (stored) {
    $('bg-img').src = stored;
    return;
  }
  // Fall back to a bundled screenshot if one was dropped into assets/.
  const probe = new Image();
  probe.onload = () => { $('bg-img').src = probe.src; };
  probe.src = '/assets/premiere.png';
}

function wireDropzone() {
  const dz = $('drop');
  let depth = 0;

  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    depth++;
    dz.classList.add('on');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', () => {
    if (--depth <= 0) { depth = 0; dz.classList.remove('on'); }
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    dz.classList.remove('on');
    const file = e.dataTransfer?.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      try {
        localStorage.setItem(LS_KEY, url);
      } catch {
        // Image too large for localStorage — still fine for this session.
      }
      useImage(url);
    };
    reader.readAsDataURL(file);
  });
}

// ------------------------------------------------------- fullscreen/wake

async function goFullscreen() {
  try { await document.documentElement.requestFullscreen(); } catch {}
}

let wakeLock = null;
async function keepAwake() {
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    // Not available (non-secure context or unsupported) — harmless.
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !wakeLock) keepAwake();
});

// The alert's own button dismisses it, so the actor can click it on camera
// without the operator touching the phone.
$('batt-modal-ok').addEventListener('click', () => send({ cmd: 'battery', style: 'none' }));

// ------------------------------------------------------- wake on mousemove

// A faded screen is only asleep: moving the mouse brings it back, the way a
// display waking would. A screen that was *cut* to black is dead and ignores
// this. A small travel threshold keeps a stray event from waking it.
let wakeTravel = 0;
let lastPointer = null;

window.addEventListener('mousemove', (e) => {
  if (!state.black.on || !state.black.wake) {
    wakeTravel = 0;
    lastPointer = null;
    return;
  }
  if (lastPointer) {
    wakeTravel += Math.hypot(e.clientX - lastPointer[0], e.clientY - lastPointer[1]);
  }
  lastPointer = [e.clientX, e.clientY];

  if (wakeTravel > 12) {
    wakeTravel = 0;
    lastPointer = null;
    send({ cmd: 'black', on: false, fadeMs: 220 });
  }
});

// ------------------------------------------------- keyboard backup remote

function wireKeys() {
  window.addEventListener('keydown', (e) => {
    const r = state.render;
    switch (e.key) {
      case ' ':
        e.preventDefault();
        send({ cmd: r.paused ? 'render.play' : 'render.pause' });
        break;
      case 'ArrowRight': send({ cmd: 'render.nudge', delta: 5 }); break;
      case 'ArrowLeft':  send({ cmd: 'render.nudge', delta: -5 }); break;
      case 's': case 'S': send({ cmd: 'render.stall', on: !r.stalled }); break;
      case 'b': case 'B': send({ cmd: 'battery', style: 'banner' }); break;
      case 'm': case 'M': send({ cmd: 'battery', style: 'modal' }); break;
      case 'Escape':     send({ cmd: 'battery', style: 'none' }); break;
      // Mac "delete" is Backspace; forward-delete reports 'Delete'. Only a
      // machine that was cut dead flashes the battery — a sleeping one wakes.
      case 'Backspace': case 'Delete':
        e.preventDefault();
        if (state.black.on && !state.black.wake) send({ cmd: 'deadbattery', ms: 2600 });
        break;
      case 'g': case 'G': send({ cmd: 'glitch.burst', ms: 420 }); break;
      case 'h': case 'H': send({ cmd: 'glitch.set', on: !state.glitch.on }); break;
      case 'd': case 'D': send({ cmd: 'power.drain', on: !state.power.draining }); break;
      case 'k': case 'K':
        send({ cmd: 'black', on: !state.black.on, fadeMs: 0, wake: false });
        break;
      case 'f': case 'F':
        send({ cmd: 'black', on: !state.black.on, fadeMs: 1400, wake: true });
        break;
      case 'r': case 'R': send({ cmd: 'reset' }); break;
    }
  });
}

// ------------------------------------------------------------------ boot

buildFakeUI();
loadStoredImage();
wireDropzone();
wireKeys();
applyState();
connect();
clock();
setInterval(clock, 10000);
tick();

// The hint gets out of the way on its own; any interaction also dismisses it.
const dismissHint = () => $('hint').classList.add('gone');
setTimeout(dismissHint, 12000);
document.addEventListener('click', () => {
  dismissHint();
  goFullscreen();
  keepAwake();
});
document.addEventListener('keydown', dismissHint);

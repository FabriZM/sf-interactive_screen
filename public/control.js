/* The phone remote. Every control is one POST; state comes back over SSE. */

const $ = (id) => document.getElementById(id);
let state = structuredClone(DEFAULT_STATE);
let cueIndex = 0;
let live = false;    // has the server told us the real state yet?
let fadeMs = 1000;
let burstMs = 420;
let dragging = false;

function send(payload) {
  return fetch('/cmd', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

// A radio-style chip row: highlight the tapped chip, hand its value to `onPick`.
function pickOne(containerId, attr, onPick) {
  const box = $(containerId);
  for (const chip of box.querySelectorAll(`[data-${attr}]`)) {
    chip.addEventListener('click', () => {
      for (const o of box.children) o.classList.toggle('on', o === chip);
      onPick(chip.dataset[attr]);
    });
  }
}

// For chip rows whose value lives on the server, mirror the authoritative
// value back so a second phone (or a keyboard press) can't desync the UI.
function syncChips(containerId, attr, value) {
  for (const chip of $(containerId).children) {
    chip.classList.toggle('on', Number(chip.dataset[attr]) === Number(value));
  }
}

// ------------------------------------------------------------------- cue

function renderCue() {
  const step = CUES[cueIndex];
  const btn = $('cue');
  const done = cueIndex >= CUES.length;

  btn.classList.toggle('done', done);
  btn.querySelector('.cue-step').textContent = done ? 'END' : `CUE ${cueIndex + 1}`;
  btn.querySelector('.cue-label').textContent = done ? 'Sequence complete' : step.label;
  btn.querySelector('.cue-hint').textContent = done ? 'tap reset to go again' : step.hint;

  $('cue-pips').innerHTML = CUES.map(
    (_, i) => `<i class="${i < cueIndex ? 'on' : ''}"></i>`
  ).join('');
}

// Fire one cue. A command carrying `at` is held back that many ms, for beats
// that have to land *inside* a cue rather than on the tap — the jump hidden
// behind the fade. Same-delay commands still travel as one POST.
function fireCue(cmds) {
  const groups = new Map();
  for (const { at = 0, ...cmd } of cmds) {
    if (!groups.has(at)) groups.set(at, []);
    groups.get(at).push(cmd);
  }
  for (const [at, batch] of groups) {
    if (at > 0) setTimeout(() => send(batch), at);
    else send(batch);
  }
}

$('cue').addEventListener('click', () => {
  if (cueIndex >= CUES.length) return;
  fireCue(CUES[cueIndex].cmds);
  cueIndex++;
  renderCue();
});

$('cue-back').addEventListener('click', () => {
  cueIndex = Math.max(0, cueIndex - 1);
  renderCue();
});

$('cue-reset').addEventListener('click', () => {
  cueIndex = 0;
  renderCue();
  send({ cmd: 'reset' });
});

$('reset').addEventListener('click', () => {
  cueIndex = 0;
  renderCue();
  send({ cmd: 'reset' });
});

// -------------------------------------------------------------- controls

// Any button carrying data-cmd just forwards its payload.
for (const btn of document.querySelectorAll('[data-cmd]')) {
  btn.addEventListener('click', () => send(JSON.parse(btn.dataset.cmd)));
}

// Jump chips
$('jumps').innerHTML = [0, 25, 50, 75, 99, 100]
  .map((p) => `<button class="chip" data-pct="${p}">${p}%</button>`)
  .join('');
for (const b of $('jumps').querySelectorAll('[data-pct]')) {
  b.addEventListener('click', () => send({ cmd: 'render.set', pct: Number(b.dataset.pct) }));
}

// Elapsed-time clock on the encode dialog: mm:ss or h:mm:ss in, jump to it
// and keep counting up from there.
function parseHMS(text) {
  const parts = String(text).trim().split(':').map((s) => Number(s));
  if (parts.length < 1 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  let secs = 0;
  for (const n of parts) secs = secs * 60 + n;
  return secs;
}

function fmtHMS(secs) {
  secs = Math.max(0, Math.round(secs));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

$('elapsedset').addEventListener('click', () => {
  const secs = parseHMS($('elapsedinput').value);
  if (secs == null) return;
  send({ cmd: 'render.elapsed.set', secs });
});
for (const b of $('elapsedjumps').querySelectorAll('[data-esecs]')) {
  b.addEventListener('click', () => send({ cmd: 'render.elapsed.set', secs: Number(b.dataset.esecs) }));
}

// Prefill the field with the live value once, same reasoning as the clock
// picker — otherwise "Set" with an untouched field is a silent no-op.
let elapsedPrefilled = false;

// Sliders are two-way: the finger drives them, but they also mirror live
// state. Writing .value must never look like a user edit — otherwise the
// mirror feeds itself back as a command and the remote fights its own
// running progress or battery drain.
let syncing = false;
function mirror(el, value) {
  syncing = true;
  el.value = value;
  syncing = false;
}

// Real edits only: synthetic events and our own mirroring are ignored.
function onUserInput(el, handler) {
  el.addEventListener('input', (e) => {
    if (syncing || !e.isTrusted) return;
    handler();
  });
}

const slider = $('slider');
const endDrag = () => { dragging = false; };
slider.addEventListener('pointerdown', () => { dragging = true; });
slider.addEventListener('pointerup', endDrag);
slider.addEventListener('pointercancel', endDrag);
slider.addEventListener('change', endDrag);
onUserInput(slider, () => {
  dragging = true;
  send({ cmd: 'render.set', pct: Number(slider.value) });
});

// Battery level: jump chips, slider, drain
$('battjumps').innerHTML = [94, 62, 17, 9, 5, 1]
  .map((p) => `<button class="chip" data-bpct="${p}">${p}%</button>`)
  .join('');
// A battery jump reads as a sudden drop on camera, so it doubles as a glitch
// cue — same burst length/intensity as the Glitch section's own button.
for (const b of $('battjumps').querySelectorAll('[data-bpct]')) {
  b.addEventListener('click', () => send([
    { cmd: 'power.set', pct: Number(b.dataset.bpct) },
    { cmd: 'glitch.burst', ms: burstMs },
  ]));
}

const battSlider = $('battslider');
let battDragging = false;
const endBattDrag = () => { battDragging = false; };
battSlider.addEventListener('pointerdown', () => { battDragging = true; });
battSlider.addEventListener('pointerup', endBattDrag);
battSlider.addEventListener('pointercancel', endBattDrag);
battSlider.addEventListener('change', endBattDrag);
onUserInput(battSlider, () => {
  battDragging = true;
  send({ cmd: 'power.set', pct: Number(battSlider.value) });
});

$('drain').addEventListener('click', () =>
  send({ cmd: 'power.drain', on: !state.power.draining })
);
pickOne('drainrate', 'permin', (v) => send({ cmd: 'power.rate', perMin: Number(v) }));

// Glitch
$('burst').addEventListener('click', () => send({ cmd: 'glitch.burst', ms: burstMs }));
$('hold').addEventListener('click', () => send({ cmd: 'glitch.set', on: !state.glitch.on }));
pickOne('gi', 'gi', (v) => send({ cmd: 'glitch.set', on: state.glitch.on, intensity: Number(v) }));
pickOne('burstlen', 'ms', (v) => { burstMs = Number(v); });

// Toggles
$('stall').addEventListener('click', () =>
  send({ cmd: 'render.stall', on: !state.render.stalled })
);
$('showdlg').addEventListener('click', () =>
  send({ cmd: 'render.show', on: !state.render.visible })
);
$('menubar').addEventListener('click', () => send({ cmd: 'menubar', on: !state.menubar }));

// Fade puts the screen to sleep — wake:true means the mouse can bring it back.
pickOne('fades', 'fade', (v) => { fadeMs = Number(v); });
$('fade').addEventListener('click', () => send({ cmd: 'black', on: true, fadeMs, wake: true }));

// ---------------------------------------------------------------- tabs

for (const btn of $('tabs').children) {
  btn.addEventListener('click', () => {
    for (const other of $('tabs').children) other.classList.toggle('on', other === btn);
    for (const pane of document.querySelectorAll('.pane')) {
      pane.classList.toggle('on', pane.id === `tab-${btn.dataset.tab}`);
    }
    window.scrollTo(0, 0);
  });
}

// ------------------------------------------------------- the actor's phone

// Who's calling is set-up rather than take state, so the fields are prefilled
// from the server once and only pushed when you hit Set. Not before the first
// state message, or they'd fill with the defaults this page starts from and
// quietly overwrite the real contact on the next Set.
let callPrefilled = false;

$('callring').addEventListener('click', () => send({ cmd: 'call.ring' }));
$('callidle').addEventListener('click', () => send({ cmd: 'call.idle' }));
$('tone').addEventListener('click', () => send({ cmd: 'call.tone', on: !state.call.tone }));

$('callwho').addEventListener('click', () =>
  send({ cmd: 'call.who', name: $('callname').value, sub: $('callsub').value })
);

// The contact photo goes to its own endpoint, not through the state — see
// the note on /photo in server.js.
function sendPhoto(dataURL) {
  return fetch('/photo', { method: 'POST', body: dataURL }).catch(() => {});
}

// A camera-roll photo is far too big to hand around, and far bigger than a
// phone screen needs — square-crop it and knock it down on the way in.
function shrink(file, size = 720) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const out = Math.min(size, side);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = out;
        canvas.getContext('2d').drawImage(
          img,
          (img.width - side) / 2, (img.height - side) / 2, side, side,
          0, 0, out, out
        );
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

$('photobtn').addEventListener('click', () => $('photofile').click());

$('photofile').addEventListener('change', async () => {
  const file = $('photofile').files?.[0];
  if (!file) return;
  $('photonote').textContent = 'sending…';
  const url = await shrink(file).catch(() => null);
  if (!url) {
    $('photonote').textContent = "couldn't read that image";
    return;
  }
  await sendPhoto(url);
  $('photofile').value = '';   // same file twice in a row still fires change
});

$('photoclear').addEventListener('click', () => sendPhoto(''));

// The blanking delay has an "off" chip, so this row can't use the numeric
// pickOne/syncChips pair the others share.
for (const chip of $('proxdelay').children) {
  chip.addEventListener('click', () => {
    const v = chip.dataset.prox;
    send({ cmd: 'call.prox', delayMs: v === 'off' ? null : Number(v) });
  });
}

function syncProxChips() {
  const delay = state.call.proxDelayMs;
  for (const chip of $('proxdelay').children) {
    const v = chip.dataset.prox;
    chip.classList.toggle('on', delay == null ? v === 'off' : Number(v) === delay);
  }
}

// The preview follows the version in the state, so it's right on a fresh
// reload and on a second remote — not just on the phone that uploaded it.
let shownPhotoV = null;

function syncPhoto(v) {
  if (v === shownPhotoV) return;
  shownPhotoV = v;
  const has = v > 0;
  $('photobtn').classList.toggle('has-photo', has);
  if (has) $('photoimg').src = `/photo?v=${v}`;
  $('photonote').textContent = has
    ? 'tap to pick a different one'
    : 'tap to pick one from this phone';
}

const CALL_MODE = {
  idle: 'idle',
  ringing: 'ringing',
  active: 'in call',
  ended: 'hung up',
};

// Menu bar clock
const pad2 = (n) => String(n).padStart(2, '0');

// datetime-local wants local wall time, not an ISO/UTC string.
function toInputValue(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
         `T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

$('clockset').addEventListener('click', () => {
  const v = $('clockinput').value;
  if (!v) return;
  const ms = new Date(v).getTime();
  if (Number.isNaN(ms)) return;
  send({ cmd: 'clock.set', ms, running: state.clock.running });
});
$('clockreset').addEventListener('click', () => send({ cmd: 'clock.reset' }));
$('clockreal').addEventListener('click', () => send({ cmd: 'clock.real' }));
$('clockrun').addEventListener('click', () =>
  send({ cmd: 'clock.run', on: !state.clock.running })
);

// Prefill the picker once, so "Set" without touching it is a no-op surprise.
let clockPrefilled = false;

// --------------------------------------------------------------- display

function paint() {
  const r = state.render;
  const pct = currentPct(r);
  const batt = currentBattery(state.power);

  const low = batt <= 20;

  $('pct').textContent = pct.toFixed(0);
  $('sliderval').textContent = pct.toFixed(0) + '%';
  slider.style.setProperty('--fill', pct + '%');
  if (!dragging) mirror(slider, pct);

  $('battpct').textContent = batt.toFixed(0);
  $('battpct').parentElement.classList.toggle('low', low);
  $('battsliderval').textContent = batt.toFixed(0) + '%';
  battSlider.style.setProperty('--fill', batt + '%');
  battSlider.classList.toggle('low', low);
  if (!battDragging) mirror(battSlider, batt);

  const elapsedSecs = currentElapsedMs(r) / 1000;
  $('elapsednow').textContent = fmtHMS(elapsedSecs);
  if (!elapsedPrefilled) {
    elapsedPrefilled = true;
    $('elapsedinput').value = fmtHMS(elapsedSecs);
  }

  $('stall').classList.toggle('on', r.stalled);
  $('showdlg').classList.toggle('on', r.visible);
  $('menubar').classList.toggle('on', state.menubar);
  $('drain').classList.toggle('on', state.power.draining);
  $('hold').classList.toggle('on', state.glitch.on);

  syncChips('gi', 'gi', state.glitch.intensity);
  syncChips('drainrate', 'permin', state.power.drainPerMin);

  const call = state.call;
  const dark = callDark(call);
  $('callnow').textContent =
    call.status === 'idle' ? call.name : `${call.name} · ${fmtHMS(callSecs(call))}`;
  $('callmode').textContent = dark ? 'to the ear' : CALL_MODE[call.status];
  $('callnow').parentElement.classList.toggle('custom', call.status !== 'idle');
  document.body.classList.toggle('calling', call.status !== 'idle');
  $('callring').querySelector('.cue-label').textContent =
    call.status === 'idle' ? 'Ring' : 'Ring again';
  $('tone').classList.toggle('on', call.tone);
  syncProxChips();
  syncPhoto(call.photoV);
  if (!callPrefilled && live) {
    callPrefilled = true;
    $('callname').value = call.name;
    $('callsub').value = call.sub;
  }
  $('photomono').textContent = initials(call.name);

  const custom = state.clock.mode === 'custom';
  const shown = currentClock(state.clock);
  $('clocknow').textContent = new Date(shown).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  $('clockmode').textContent = custom ? (state.clock.running ? 'custom' : 'frozen') : 'real time';
  $('clocknow').parentElement.classList.toggle('custom', custom);
  $('clockrun').classList.toggle('on', state.clock.running);

  if (!clockPrefilled) {
    clockPrefilled = true;
    $('clockinput').value = toInputValue(shown);
  }
}

setInterval(paint, 100);

// ------------------------------------------------------------------- net

function connect() {
  const es = new EventSource('/events');
  es.onmessage = (e) => {
    state = JSON.parse(e.data);
    live = true;
    document.querySelector('.status').classList.add('live');
    $('conn').textContent = 'connected';
    paint();
  };
  es.onerror = () => {
    document.querySelector('.status').classList.remove('live');
    $('conn').textContent = 'reconnecting…';
  };
}

renderCue();
connect();
paint();

/* The actor's phone. Pure renderer like screen.js: the server owns the call
   and the remote sets it up, this only draws it — plus the taps the actor
   makes on camera (answer, hang up, screen off the ear), which go back to
   the server so the remote stays in step. */

// ---- Copy you may want to retype between takes -------------------------
const PHONE = {
  battery: 78,           // status-bar battery, in percent
  signal: 3,             // lit bars, 0-4
  ended: 'Llamada finalizada',
  endedHoldMs: 2200,     // how long that stays up before the phone goes dark
};

// The six buttons on the in-call screen. Decoration — they light up when
// tapped and do nothing else, same as they would in a shot.
const ACTIONS = [
  ['silenciar', 'M15 11V5a3 3 0 0 0-5.8-1.1M9 9v2a3 3 0 0 0 4.7 2.5M5 10a7 7 0 0 0 10.6 6M19 10v1a7 7 0 0 1-.4 2.3M12 19v3M4 3l16 18'],
  ['teclado',   'DIAL'],
  ['altavoz',   'M4 9h3.5L13 4.5v15L7.5 15H4zM16.5 9.2a4 4 0 0 1 0 5.6M19.3 6.4a8 8 0 0 1 0 11.2'],
  ['añadir',    'M12 4v16M4 12h16'],
  ['FaceTime',  'BOX'],
  ['contactos', 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20.5a7.5 7.5 0 0 1 15 0'],
];
// ------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);
let state = structuredClone(DEFAULT_STATE);

// ------------------------------------------------------------- in-call pad

function buildPad() {
  const shape = (d) => {
    if (d === 'DIAL') {
      // the 3×3 of dots, drawn rather than spelled out as a path
      const dots = [];
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
          dots.push(`<circle cx="${5 + x * 7}" cy="${5 + y * 7}" r="2.1"/>`);
        }
      }
      return `<svg viewBox="0 0 24 24">${dots.join('')}</svg>`;
    }
    if (d === 'BOX') {
      return `<svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="13" height="12"
        rx="3"/><path d="M16.5 11l5-3.2v8.4l-5-3.2z"/></svg>`;
    }
    return `<svg viewBox="0 0 24 24" fill="none"><path d="${d}" stroke="currentColor"
      stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  };

  $('pad').innerHTML = ACTIONS.map(
    ([label, d]) => `<button class="tile"><i>${shape(d)}</i><span>${label}</span></button>`
  ).join('');

  // Fake, but they have to *feel* real if a finger lands on one on camera.
  for (const tile of $$('.tile')) {
    tile.addEventListener('click', (e) => {
      e.stopPropagation();          // never blanks the screen
      tile.classList.toggle('on');
    });
  }
}

// --------------------------------------------------------------- contacto

function usePhoto(url) {
  document.body.classList.toggle('photo', !!url);
  for (const img of $$('.avatar img')) img.src = url || '';
  $('wall').style.backgroundImage = url ? `url("${url}")` : '';
}

// A photo dropped into assets/ before the shoot, either extension — no build
// step means no way to know which one is there.
function probeAssets() {
  let i = 0;
  const names = ['/assets/contacto.jpg', '/assets/contacto.png'];
  const probe = new Image();
  probe.onload = () => { if (shownPhotoV === 0) usePhoto(probe.src); };
  probe.onerror = () => { if (++i < names.length) probe.src = names[i]; };
  probe.src = names[0];
}

// The photo is picked on the remote and served from /photo; the version in
// the state is the only thing that travels, and it's what tells us to
// reload. Nothing to do until it changes.
let shownPhotoV = null;

function loadPhoto(v) {
  if (v === shownPhotoV) return;
  shownPhotoV = v;
  if (v > 0) {
    usePhoto(`/photo?v=${v}`);
    return;
  }
  usePhoto(null);
  probeAssets();
}

// ------------------------------------------------- fullscreen / en reposo

// Android hides its system bars for a page that asks, which is the whole
// difference between a prop and a browser window on camera. iOS Safari has
// no such API — there the answer is Share → Add to Home Screen, and the
// manifest/meta tags above cover both.
async function goFullscreen() {
  try {
    await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
  } catch {
    // Denied, or iOS. Harmless.
  }
  try {
    await screen.orientation?.lock?.('portrait');   // a phone prop is portrait
  } catch {
    // Not allowed outside fullscreen on some builds. Also harmless.
  }
  syncChrome();
}

// Whether to draw our own status bar: only when nothing else is drawing one.
// Installed to the home screen without fullscreen, the system puts its real
// bar on top of the page and ours would be a second one.
function syncChrome() {
  const mode = (m) => window.matchMedia(`(display-mode: ${m})`).matches;
  const full = !!document.fullscreenElement || mode('fullscreen');
  const installed = navigator.standalone || mode('standalone') || mode('minimal-ui');
  document.body.classList.toggle('standalone', installed && !full);
}
document.addEventListener('fullscreenchange', syncChrome);

// One tap on the idle phone does the two things that need a user gesture:
// go fullscreen, and buy the right to make a sound later. After it, the
// hint gets out of the way and the phone is just black.
document.addEventListener('click', () => {
  if (state.call.status !== 'idle') return;
  unlockAudio();
  goFullscreen();
  $('idle').classList.add('ready');
});

// ------------------------------------------------------------------ tono

// A ringtone with no audio file to ship: a four-note figure on a loop, quiet
// enough not to fight production sound. Switched from the remote, off by
// default — sound department gets a say — and it dies the instant the call
// is answered.
let actx = null;
let ringTimer = null;

function unlockAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
  }
  if (actx.state === 'suspended') actx.resume().catch(() => {});
}
document.addEventListener('touchstart', unlockAudio, { passive: true });
document.addEventListener('click', unlockAudio);

function blip(at, freq) {
  const osc = actx.createOscillator();
  const gain = actx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.22, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.85);
  osc.connect(gain).connect(actx.destination);
  osc.start(at);
  osc.stop(at + 0.9);
}

function ringPhrase() {
  if (!actx) return;
  const t = actx.currentTime + 0.02;
  [880, 1108.7, 1318.5, 1760].forEach((f, i) => blip(t + i * 0.22, f));
}

function ringPulse() {
  if (state.call.tone) ringPhrase();
  navigator.vibrate?.([700, 400]);   // Android buzzes; iOS ignores this
}

// Only ever called on a transition: every unrelated state message (a battery
// drain, a glitch) arrives here too, and restarting the loop on each one
// would make the phone stutter instead of ring.
let wasRinging = false;

function ringing(on) {
  if (on === wasRinging) return;
  wasRinging = on;
  clearInterval(ringTimer);
  ringTimer = null;
  if (!on) {
    navigator.vibrate?.(0);
    return;
  }
  if (state.call.tone) unlockAudio();
  ringPulse();
  ringTimer = setInterval(ringPulse, 2600);
}

// ------------------------------------------------------------------ taps

$('answer').addEventListener('click', (e) => {
  e.stopPropagation();
  unlockAudio();
  send({ cmd: 'call.answer' });
});

for (const id of ['decline', 'end']) {
  $(id).addEventListener('click', (e) => {
    e.stopPropagation();
    send({ cmd: 'call.end' });
  });
}

// Proximity, by hand. The phone comes off the ear and the screen lights up;
// tap it again and it goes dark, so the actor can play the whole beat
// without the operator touching anything.
function toggleProx(e) {
  if (state.call.status !== 'active') return;
  e.stopPropagation();
  send({ cmd: 'call.prox', prox: callDark(state.call) ? 'far' : 'near' });
}
$('dark').addEventListener('click', toggleProx);
$('oncall').addEventListener('click', toggleProx);

// ---------------------------------------------------------------- render

// Only what a new state changes. The counter and the blackout move on their
// own between messages, so they live in draw().
function applyState() {
  const c = state.call;
  document.body.dataset.status = c.status;

  for (const el of $$('.name')) el.textContent = c.name;
  for (const el of $$('.avatar .mono')) el.textContent = initials(c.name);
  for (const el of $$('.sub')) el.textContent = c.sub;

  loadPhoto(c.photoV);
  ringing(c.status === 'ringing');
  clock();
}

function pad2(n) {
  return String(Math.floor(n)).padStart(2, '0');
}

function draw() {
  const now = Date.now();
  const c = state.call;

  const secs = callSecs(c, now);
  $('timer').textContent =
    c.status === 'ended'
      ? PHONE.ended
      : secs >= 3600
        ? `${Math.floor(secs / 3600)}:${pad2((secs % 3600) / 60)}:${pad2(secs % 60)}`
        : `${pad2(secs / 60)}:${pad2(secs % 60)}`;

  // Dark for the two reasons a phone goes dark: it's against an ear, or the
  // call is over and it has locked itself again.
  const finished = c.status === 'ended' && now > c.endedAt + PHONE.endedHoldMs;
  $('dark').classList.toggle('on', callDark(c, now) || finished);

  requestAnimationFrame(draw);
}

// The status bar follows the same clock as the laptop's menu bar, so both
// props agree on what time the scene happens at. 24h, like the phone would
// be set here.
function clock() {
  const d = new Date(currentClock(state.clock));
  $('sb-time').textContent = `${d.getHours()}:${pad2(d.getMinutes())}`;
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
  };
  es.onerror = () => $('dot').classList.add('show'); // EventSource retries itself
}

// ------------------------------------------------------------------ boot

syncChrome();
buildPad();
$('sb-batt-fill').style.width = Math.max(6, PHONE.battery) + '%';
for (const bar of $$('.sb-signal i')) bar.style.opacity = '.35';
for (let i = 0; i < PHONE.signal; i++) $$('.sb-signal i')[i].style.opacity = '1';

applyState();
connect();
setInterval(clock, 10000);
draw();

// The hint gets out of the way on its own too, in case nobody taps it.
setTimeout(() => $('idle').classList.add('ready'), 25000);

// The phone must not lock mid-take. This only works on a secure origin, so
// on a plain-HTTP LAN it's the belt to the README's braces: auto-lock Never.
let wakeLock = null;
async function keepAwake() {
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    // Not available — harmless.
  }
}
keepAwake();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !wakeLock) keepAwake();
});

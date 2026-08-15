// Shared between server.js, screen.js and control.js.
// Loaded as a plain script in the browser, and read via a small shim in Node.

const DEFAULT_STATE = {
  bg: 'fake',            // 'fake' | 'image'
  menubar: true,
  render: {
    visible: true,
    basePct: 12,         // percentage at the moment runningSince was set
    rate: 1.4,           // percent per second while running
    runningSince: null,  // epoch ms, or null when paused
    paused: true,
    stalled: false,      // frozen bar, clock keeps ticking
    // Elapsed time is base + real time since anchor — same pattern as the
    // battery drain — so it can be jumped to a custom value and then keeps
    // counting forward from there instead of resetting to 0.
    elapsedMs: 7 * 60000 + 6000, // 7:06 — elapsed value at elapsedAnchorMs
    elapsedAnchorMs: null, // epoch ms elapsedMs was correct; null = not running yet
    filename: 'video-NETSUL_v7_final2.mp4',
  },
  battery: 'none',       // 'none' | 'banner' | 'modal' — which alert is showing
  power: {
    basePct: 62,         // menu-bar battery level at runningSince
    drainPerMin: 12,     // percent per minute while draining
    runningSince: null,
    draining: false,
  },
  glitch: {
    on: false,           // sustained
    intensity: 2,        // 1 | 2 | 3
    burstUntil: 0,       // epoch ms; a one-shot burst runs until then
  },
  // wake: true = the screen only went to sleep, so moving the mouse brings it
  // back. false = the machine is dead and nothing wakes it.
  black: { on: false, fadeMs: 0, wake: false },
  // The dead-device battery screen. Time-boxed like a glitch burst, so it
  // still ends on time if the screen reloads mid-flash.
  dead: { untilMs: 0 },
  clock: {
    mode: 'real',        // 'real' = system clock | 'custom'
    setMs: null,         // the value you typed — never drifts, so "back to
                         // set time" always returns to it
    baseMs: null,        // what the custom clock reads at anchorMs
    anchorMs: null,      // epoch ms when it was set, reset, or (un)frozen
    running: true,       // does the custom clock tick, or is it frozen?
  },
};

// Cue list for the one-big-button workflow on the phone.
// Each step is a list of commands sent in order.
const CUES = [
  {
    label: 'Render climbing',
    hint: '12% and rising',
    cmds: [
      { cmd: 'reset' },
      { cmd: 'render.set', pct: 12 },
      { cmd: 'render.play' },
    ],
  },
  {
    label: 'Stall',
    hint: 'bar freezes, clock runs',
    cmds: [{ cmd: 'render.stall', on: true }],
  },
  {
    label: 'Fade screen',
    hint: 'sleeps — moving the mouse wakes it',
    cmds: [{ cmd: 'black', on: true, fadeMs: 1400, wake: true }],
  },
  {
    label: 'Low Battery',
    hint: 'notification banner',
    cmds: [{ cmd: 'battery', style: 'banner' }],
  },
  {
    label: 'Cut to black',
    hint: 'dead — the mouse will not wake it',
    cmds: [{ cmd: 'black', on: true, fadeMs: 0, wake: false }],
  },
];

// Current percentage, derived from the render state at time `now`.
function currentPct(render, now = Date.now()) {
  if (render.paused || render.stalled || render.runningSince == null) {
    return clampPct(render.basePct);
  }
  const secs = (now - render.runningSince) / 1000;
  return clampPct(render.basePct + secs * render.rate);
}

// Cheap deterministic pseudo-random in [0,1) from an integer seed — same
// input always gives the same output, so this stays reload-safe and in sync
// across multiple screens without any extra state.
function hash01(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const CHUNK_W = 3.5; // nominal percentage points per "section"

// What the bar actually shows, warped from the smooth internal `currentPct`.
// Real encoders don't crawl at a constant rate — they rip through easy
// sections and hang before hard ones — and a bar left running should never
// actually finish on camera. Both are purely a *display* transform: the
// linear internal value stays untouched, so settle()/ETA physics on the
// server are unaffected and nothing here compounds across pauses or stalls.
function displayPct(render, now = Date.now()) {
  const nominal = currentPct(render, now);
  const chunkIndex = Math.floor(nominal / CHUNK_W);
  const frac = (nominal - chunkIndex * CHUNK_W) / CHUNK_W;

  // Each section gets its own ease strength, so some rip by almost instantly
  // and others crawl right up to the boundary before the next jump.
  const power = 1.5 + hash01(chunkIndex) * 3;
  const eased = 1 - (1 - frac) ** power;
  // Clamp to the true 0-100 domain: CHUNK_W doesn't divide 100 evenly, so the
  // final section's own right edge can land past 100 — without this the bar
  // could momentarily show more progress than the clock has actually earned.
  const warped = Math.min(100, chunkIndex * CHUNK_W + eased * CHUNK_W);

  // The last stretch compresses hard and never quite reaches 100 — the bar
  // stalls out around 99%, the way a real export never finishes on camera.
  const capped = warped < 90 ? warped : 90 + (warped - 90) * 0.9;
  return clampPct(Math.min(capped, 99));
}

// Elapsed-time clock for the encode dialog: base value plus real time passed
// since it was last set. Runs continuously once started — pause and stall
// don't affect it, matching a real dialog that keeps timing while open.
function currentElapsedMs(render, now = Date.now()) {
  if (render.elapsedAnchorMs == null) return render.elapsedMs;
  return render.elapsedMs + (now - render.elapsedAnchorMs);
}

// Menu-bar battery level, derived the same way: a base plus elapsed drain,
// so it survives a reload and only costs a message when something changes.
function currentBattery(power, now = Date.now()) {
  if (!power.draining || power.runningSince == null) return clampPct(power.basePct);
  const mins = (now - power.runningSince) / 60000;
  return clampPct(power.basePct - mins * power.drainPerMin);
}

// True while a sustained glitch is on, or a one-shot burst is still running.
function glitchActive(glitch, now = Date.now()) {
  return glitch.on || now < glitch.burstUntil;
}

// What the menu-bar clock should read: the real time, or a custom one that
// either ticks forward from where it was set or stays frozen.
function currentClock(clock, now = Date.now()) {
  if (clock.mode !== 'custom' || clock.baseMs == null) return now;
  return clock.running ? clock.baseMs + (now - clock.anchorMs) : clock.baseMs;
}

function clampPct(p) {
  return Math.max(0, Math.min(100, p));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_STATE, CUES, currentPct, displayPct, currentElapsedMs, currentBattery,
    glitchActive, currentClock, clampPct,
  };
}

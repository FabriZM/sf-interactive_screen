/* The address has to come from the server: this page is usually open on
   localhost, and localhost is no use to the phone. */

const box = document.getElementById('code');
const link = document.getElementById('url');
const hint = document.getElementById('hint');
const targets = document.getElementById('targets');

// Two phones go on set: the operator's remote and the actor's call screen.
let target = 'control';
let net = null;

const HINTS = {
  control: 'Point the phone camera at this. It has to be on the same Wi-Fi as '
    + 'this laptop.',
  call: 'The phone that goes in frame. Open it, then Share → Add to Home '
    + 'Screen, so Safari’s toolbars don’t show on camera.',
};

function paint() {
  if (!net) return;

  const url = net[target];
  box.innerHTML = qrSvg(url);
  link.textContent = url;
  link.href = url;

  // No LAN address means no route from the phone, whatever it scans.
  const stranded = net.ip === 'localhost';
  hint.classList.toggle('warn', stranded);
  hint.textContent = stranded
    ? 'This laptop is not on a network, so the phone has nothing to reach. '
      + 'Join a Wi-Fi — or the phone’s hotspot — and this updates itself.'
    : HINTS[target];
}

async function refresh() {
  try {
    net = await (await fetch('/lan', { cache: 'no-store' })).json();
  } catch {
    hint.textContent = 'Lost the server. Is start.command still running?';
    hint.classList.add('warn');
    return;
  }
  paint();
}

for (const btn of targets.children) {
  btn.addEventListener('click', () => {
    target = btn.dataset.target;
    for (const other of targets.children) other.classList.toggle('on', other === btn);
    paint();
  });
}

// The IP moves when the laptop changes network, which on set it will.
refresh();
setInterval(refresh, 5000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh();
});

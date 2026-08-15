/* The address has to come from the server: this page is usually open on
   localhost, and localhost is no use to the phone. */

const box = document.getElementById('code');
const link = document.getElementById('url');
const hint = document.getElementById('hint');

async function refresh() {
  let net;
  try {
    net = await (await fetch('/lan', { cache: 'no-store' })).json();
  } catch {
    hint.textContent = 'Lost the server. Is start.command still running?';
    hint.classList.add('warn');
    return;
  }

  box.innerHTML = qrSvg(net.control);
  link.textContent = net.control;
  link.href = net.control;

  // No LAN address means no route from the phone, whatever it scans.
  const stranded = net.ip === 'localhost';
  hint.classList.toggle('warn', stranded);
  hint.textContent = stranded
    ? 'This laptop is not on a network, so the phone has nothing to reach. '
      + 'Join a Wi-Fi — or the phone’s hotspot — and this updates itself.'
    : 'Point the phone camera at this. It has to be on the same Wi-Fi as '
      + 'this laptop.';
}

// The IP moves when the laptop changes network, which on set it will.
refresh();
setInterval(refresh, 5000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh();
});

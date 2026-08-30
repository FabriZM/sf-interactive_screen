# ANTI — pantalla interactiva

Fake screens for a shortfilm, driven live from your phone: an Adobe Premiere
Pro render on the laptop — push the percentage, drain the battery, glitch the
picture, fire a macOS low-battery warning, cut to black — and an iPhone call
on the actor's own phone, which rings, gets answered on camera and goes dark
against the ear.

Zero dependencies. No `npm install`, no build step.

## On set

1. Copy this whole folder to the laptop that will be on camera.
2. Make sure that laptop has Node installed (`node -v`). If not: <https://nodejs.org>
3. Double-click **`start.command`**. It prints the URLs.
4. On the laptop, open the **SCREEN** URL. Click once to go fullscreen.
5. On your phone, joined to the **same Wi-Fi**, open the **PHONE** URL — or
   open **`/qr`** on the laptop and scan the code with the phone camera,
   which saves typing an IP address on set.
6. Only if the phone is in the shot: open the **CALL** URL on it, from the
   same `/qr` page with **Call screen** picked, and tap it once. Everything
   about the call is then driven from the **Call** tab on the remote. See
   *La llamada* below.

## Before rolling

- Set the phone's auto-lock to **Never** (Settings → Display & Brightness → Auto-Lock).
  The laptop keeps itself awake automatically; the phone can't, because it loads
  over plain HTTP on the LAN. This matters twice as much for a phone that's in
  frame — a prop that locks itself mid-take is a ruined take.
- Hide the browser toolbar on the laptop (fullscreen does this) and check that the
  small hint box at the bottom has faded — it disappears after 12s or on first click.
- Test the connection on the actual network you'll shoot on. Guest and corporate
  Wi-Fi often block device-to-device traffic. If the phone can't reach the laptop,
  start a personal hotspot on the phone and join the laptop to it.

## The QR page

`http://localhost:<port>/qr` on the laptop shows one big QR code, with the URL
printed under it. Scan it and the phone opens straight into the controls — no
typing an IP with someone waiting on set. The two buttons above the code pick
which phone you're setting up: **Remote** (the operator's) or **Call screen**
(the one that goes in frame).

The code always carries the laptop's **LAN** address, not `localhost`, and the
page re-checks every few seconds: switch the laptop to the phone's hotspot and
the code follows it. If the laptop isn't on a network at all, the page says so
instead of handing you a code that can't be reached.

Its QR encoder is `public/qrcode.js` — byte mode, error correction level M,
no dependencies like everything else here.

## Using your own screenshot

Two ways, either works:

- **Drag and drop** any screenshot onto the screen page. It's remembered across
  reloads on that machine.
- **Drop a file at `assets/premiere.png`** before starting. It loads automatically.

Switch between your screenshot and the built-in CSS Premiere lookalike from the
phone, under **Scene**. When using a real screenshot you'll usually want to turn
the **Menu bar** overlay *off* — your screenshot already has one.

## The phone remote

**CUE** is the main control: one big button that walks the scripted sequence.
Rehearse it once, then during a take you only ever press that one button.

1. **Renderizando** — arranca en 66% y sube lento
2. **Batería 32%** — salta a 32% + glitch fuerte
3. **Llamada** — suena el teléfono del actor
4. **Fade screen** — the screen goes to sleep
5. **Batería MODAL** — la alerta de batería baja
6. **Cut to black** — dead

Cue 4 fades the screen and cue 5 fires the modal while it's still dark, so
the natural beat is: screen sleeps → the actor moves the mouse → it wakes with
the low-battery warning already up → cut to black.

Everything else is manual override: a percentage slider, play/pause/stall,
speed, glitch, battery level and drain, both battery alert styles, cut/fade
to black, and reset between takes.

Cues live in `public/shared.js` — edit `CUES` to match your shot list. Add
steps when you know where they land in the shot, e.g.

```js
{ label: 'Battery dying', hint: 'drains from 8%',
  cmds: [{ cmd: 'power.set', pct: 8 }, { cmd: 'power.drain', on: true, perMin: 3 }] },
{ label: 'Picture breaks up', hint: 'sustained glitch',
  cmds: [{ cmd: 'glitch.set', on: true, intensity: 3 }] },
```

## La llamada

`/call` is a second prop, for the actor's own phone: an iPhone incoming call
in Spanish — contact photo and name in the middle, **Rechazar** and
**Aceptar** at the bottom. Answer it and it becomes the in-call screen with
the running counter, and a beat later the screen goes black the way it does
against an ear.

Everything on it is in Spanish because it's the one screen an audience reads.
The remote that drives it is in English like the rest of the controls.

Everything about it is set from the remote, on the **Call** tab. The phone
itself is a pure prop: open `/call` on it, tap it once, and put it down.

### On the phone, once

1. Open `/call` (scan it from `/qr` with **Call screen** picked).
2. **Tap the screen once.** That single tap is what buys fullscreen and the
   right to make a sound later — browsers only grant either off a real
   gesture. The note explaining this fades once you've done it, and the idle
   phone is then just black, which is what you want in frame anyway.
3. Set auto-lock to **Never**.

For a phone that's properly in shot, install it instead of tapping: **Add to
Home Screen** and open it from the icon. On Android that launches it
genuinely fullscreen — no address bar, no system bars, locked to portrait —
which is as close to a real phone as a web page gets. On iOS it drops
Safari's toolbars and iOS draws its own real status bar over the top.

Fullscreen on Android also works without installing: the one tap above calls
`requestFullscreen()` and locks the orientation. iOS Safari has no such API,
so there the home-screen route is the only way to lose the toolbars.

### On the remote, under Call

- **Ring** — the big green button. Then the actor answers on the phone
  itself; that's their move, on camera. **Answer for them** is for rehearsing
  without a second person.
- **Contact photo** — picked from the *operator's* phone library,
  square-cropped, shrunk, and pushed to the actor's phone over the network.
  With none set, the phone falls back to `assets/contacto.jpg` (or `.png`),
  then to the grey circle with the contact's initials.
- **Nombre / Debajo** — who's calling and the small line under it (`móvil`,
  `iPhone`, a number). Survives **Reset everything**, like the clock — it's
  set-up, not take state.
- **Ringtone** — a synthesized tone, off by default so it can't walk over
  production sound. It needs that one tap on the phone to be allowed to play.
- A green dot on the **Call** tab means a call is live, so you can see it
  from the Screen tab.

Browsers have no proximity sensor, so that blanking is a timer: it fires
`0.8s` / `1.5s` / `3s` after the call is answered, or never on **manual**.
Either way you keep both overrides:

- **the actor** taps the dark screen to light it back up (phone away from the
  ear), and taps the lit screen to blank it again
- **the operator** forces it with **To the ear** / **Off the ear**

Hanging up leaves *Llamada finalizada* up for a couple of seconds and then the
phone goes dark. **Reset call** puts it back to idle for the next take.

The six in-call buttons (silenciar, teclado, altavoz…) are decoration — they
light up under a finger and do nothing else, which is all they need to do in
a shot.

### In the cue list

The call runs on the same command bus as everything else, so it's part of the
scripted sequence rather than a manual cue — cue 3 in `CUES`
(`public/shared.js`) only rings, because answering is the actor's move on
camera:

```js
{ label: 'Llamada', hint: 'suena el teléfono del actor',
  cmds: [{ cmd: 'call.ring' }] },
```

The commands are `call.ring`, `call.answer`, `call.end`, `call.idle`,
`call.who` (`{ name, sub }`), `call.tone` (`{ on }`) and `call.prox`
(`{ prox: 'near' | 'far' | 'auto', delayMs }`).

The photo is the one thing that isn't a command: it's POSTed to `/photo` as a
data URL and served back from `/photo` as a file. Only a version number rides
along in the state — a photo in there would be re-sent to every screen on
every battery tick.

## Render progress

What's on screen is deliberately not a smooth ramp. It's split into small
"sections" that each rip forward quickly and then hang before the next jump —
the uneven pace real encoders have — and it never actually reaches 100%: the
last stretch compresses hard and the bar stalls out at 99%, same as a real
export that never quite finishes on camera.

This is a display-only effect — the % you set from the phone (slider, jump
chips, cue steps) is the smooth underlying value the pacing is built from;
what warps and caps is purely what gets drawn. Setting 100% from the phone is
still how you tell it "this take is done," it'll just show 99% doing it.

## Glitch

**Glitch burst** is a one-shot hit — pick `flash` / `short` / `long` for its
length. **Hold glitch** leaves it running until you turn it off. Intensity is
`subtle` / `medium` / `heavy`.

The effect is inverted tear bands, a rolling vsync bar, chromatic fringing,
full-frame invert flashes, scanlines, noise, and a whole-frame jitter with
skew and scale. `heavy` is genuinely violent — the picture inverts, tears
sideways and shakes. `subtle` leaves the dialog readable.

The bands are blend-mode fills rather than drawn artwork, so they invert
whatever is actually underneath and look right over both the built-in fake UI
and your own screenshot, with no per-background tuning.

Bursts are timestamped on the server, so a burst fired while the screen is
reloading still ends at the right moment instead of sticking on.

## Fade vs cut

These are two different things, and the difference is whether the laptop is
asleep or dead:

- **Fade screen** — the display goes to sleep. **Moving the mouse brings it
  back**, on its own, without touching the phone. That's the actor's move.
- **Cut to black** — the machine is dead. The mouse does nothing. Only
  **Restore screen** on the phone brings it back.

Waking needs about 12px of mouse travel, so a knock against the desk won't
trigger it.

The mouse pointer is visible the whole time the screen has a picture, and
disappears only once it has actually gone dark — on a fade it stays up for the
full fade rather than popping out the moment it starts, and it comes straight
back on wake. It's always the plain arrow, never a text I-beam or a link hand.

While the screen is **cut**, pressing **delete** on the laptop flashes the
dead-battery screen — the empty battery with the red sliver and the
plug → bolt prompt — for about 2.6 seconds, then back to black. It only works
on a cut screen: a merely sleeping one wakes on the mouse instead. There's a
**Dead battery** button on the phone too, if you'd rather cue it than have the
actor press the key.

## Menu bar clock

Set any date and time for the menu bar — useful when the scene is meant to be
3am, or just for continuity so every take shows the same time.

- **Set** — apply the date/time you picked
- **Back to set time** — jump back to that exact value after it has ticked on
- **Running / frozen** — let it tick forward, or freeze it dead (frozen is
  best for continuity across takes)
- **Use real time** — back to the system clock

The clock survives **Reset everything** and cue 1, which reset before every
take — otherwise you'd lose your setting on every run.

## Battery

The menu-bar battery is fully controllable: set the level with the slider or
the jump chips (`100 · 62 · 20 · 10 · 5 · 1`), and hit **Drain** to make it
fall in real time. Rate is `slow` (3%/min), `medium` (12%/min) or `fast`
(60%/min — 1% per second, for when you need it dead within a take).
**Hold level** stops the drain wherever it is.

It turns red at 20% or below, and floors at 0% rather than going negative.
The drain and the low-battery alert are independent — fire the alert whenever
the beat calls for it, at whatever level the battery happens to be showing.

## Keyboard backup

If the phone dies mid-shoot, the laptop responds to keys directly:

| Key | Action |
|---|---|
| `Space` | play / pause the render |
| `←` `→` | nudge ±5% |
| `S` | stall (bar freezes, clock keeps running) |
| `G` | glitch burst |
| `H` | hold glitch on / off |
| `D` | battery drain on / off |
| `B` / `M` | low battery banner / modal |
| `Esc` | dismiss the alert |
| `K` / `F` | cut to black (dead) / fade screen (wakes on mouse) |
| `delete` | dead-battery screen (only while cut to black) |
| `R` | reset |

## Changing the on-screen copy

Filenames, sequence name, timecode and bin contents are all in one `TEXT` object
at the top of `public/screen.js`.

The call screen has the same thing at the top of `public/call.js`: `PHONE`
holds its status-bar battery and signal, the *Llamada finalizada* wording and
how long it stays up; `ACTIONS` is the six in-call buttons and their labels.
`public/manifest.json` is what makes Android launch it fullscreen and
portrait from the home screen.

The two alerts are plain markup in `public/screen.html` — search for
`mac-banner` and `mac-modal`. The modal is in Spanish ("Batería baja en el
Mac") and the banner is still in English; edit either in place.

The modal's **Aceptar** button dismisses it from the laptop, so the actor can
click it on camera without the operator touching the phone. Clicking the dimmed
backdrop does nothing, same as a real macOS alert.

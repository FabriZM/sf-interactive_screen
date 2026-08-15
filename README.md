# ANTI — pantalla interactiva

A fake Adobe Premiere Pro screen for a shortfilm, driven live from your phone:
push the render percentage, drain the battery, glitch the picture, fire a
macOS low-battery warning, cut to black.

Zero dependencies. No `npm install`, no build step.

## On set

1. Copy this whole folder to the laptop that will be on camera.
2. Make sure that laptop has Node installed (`node -v`). If not: <https://nodejs.org>
3. Double-click **`start.command`**. It prints the URLs.
4. On the laptop, open the **SCREEN** URL. Click once to go fullscreen.
5. On your phone, joined to the **same Wi-Fi**, open the **PHONE** URL — or
   open **`/qr`** on the laptop and scan the code with the phone camera,
   which saves typing an IP address on set.

## Before rolling

- Set the phone's auto-lock to **Never** (Settings → Display & Brightness → Auto-Lock).
  The laptop keeps itself awake automatically; the phone can't, because it loads
  over plain HTTP on the LAN.
- Hide the browser toolbar on the laptop (fullscreen does this) and check that the
  small hint box at the bottom has faded — it disappears after 12s or on first click.
- Test the connection on the actual network you'll shoot on. Guest and corporate
  Wi-Fi often block device-to-device traffic. If the phone can't reach the laptop,
  start a personal hotspot on the phone and join the laptop to it.

## The QR page

`http://localhost:<port>/qr` on the laptop shows one big QR code for the phone
remote, with the URL printed under it. Scan it and the phone opens straight
into the controls — no typing an IP with someone waiting on set.

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

1. **Render climbing** — 12% and rising
2. **Stall** — bar freezes, clock keeps running
3. **Fade screen** — the screen goes to sleep
4. **Low Battery** — notification banner
5. **Cut to black** — dead

Cue 3 fades the screen and cue 4 fires the banner while it's still dark, so
the natural beat is: screen sleeps → the actor moves the mouse → it wakes with
the low-battery warning already up → cut to black.

Everything else is manual override: a percentage slider, play/pause/stall,
speed, glitch, battery level and drain, both battery alert styles, cut/fade
to black, and reset between takes.

Cues live in `public/shared.js` — edit `CUES` to match your shot list. The
default four don't include glitch or battery drain; add them as steps when
you know where they land in the shot, e.g.

```js
{ label: 'Battery dying', hint: 'drains from 8%',
  cmds: [{ cmd: 'power.set', pct: 8 }, { cmd: 'power.drain', on: true, perMin: 3 }] },
{ label: 'Picture breaks up', hint: 'sustained glitch',
  cmds: [{ cmd: 'glitch.set', on: true, intensity: 3 }] },
```

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

The two alerts are plain markup in `public/screen.html` — search for
`mac-banner` and `mac-modal`. The modal is in Spanish ("Batería baja en el
Mac") and the banner is still in English; edit either in place.

The modal's **Aceptar** button dismisses it from the laptop, so the actor can
click it on camera without the operator touching the phone. Clicking the dimmed
backdrop does nothing, same as a real macOS alert.

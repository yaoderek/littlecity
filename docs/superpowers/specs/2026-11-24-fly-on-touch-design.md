# Fly mode on touch screens

Derek, 2026-11-24: "add flightmode support to mobile? like with a joystick?" Approved as below the same day
("just wings button, no up/down, no speed").

**Goal.** A player on a phone or tablet can fly round their own town, and come back to exactly the view they left.
**Not in it.** Up and down buttons, a speed control, tilt steering, any change to flying with a mouse.

## Approaches

| | Trade-off |
|---|---|
| **A stick, and drag to look (picked)** | What players of touch games know; stops to watch something. Two thumbs. |
| Two sticks, as a drone | Precise, hard for casual players. |
| Always moving, one thumb steers | Easiest; cannot stop and watch. |

## What it does

- **In.** Wings beside the sky button (hidden while the sky is open, which needs the room). The eye's shaders and
  target are made on the first tap, not at page start; the wings wiggle until they are ready (2.5 s at the most).
- **Flying.** A thumb landing in the left half, below the top 40 %, holds the stick, which comes to where it landed;
  a drag anywhere else looks. Forward is the way the eye looks, so looking up and pushing climbs. Farther is faster
  (dead zone 12 %, full at 52 px). Past 52 px the stick's base follows the thumb. At rest the stick stands at the
  bottom left. 0.4° of turn a pixel (the mouse: 0.16°); dragging right looks right. One finger each: more do nothing.
- **Out.** A "Land" button, top left.
- **The lens.** At least 50° across on an upright screen (62° up and down is 31° across on an iPhone). On touch, a
  flight begun zoomed in (a narrow lens) opens to the full one once in. Turning the phone over changes the lens.
- **Interrupted** (a call, another app, a cancelled touch): every thumb is let go; the eye comes to rest.

## Steps

1. `src/fly/thumbs.ts` (pure: who holds the stick, who looks), `addDrag` in `src/fly/look.ts`, `src/fly/lens.ts`
   (`flyFov(aspect)`), each with unit tests first.
2. `prepareEye(): Promise<void>` (`src/render`). `src/ui/fly.ts`: thumbs, stick, Land, lens. `ui.css`, the corner.
3. Browser tests (`tests/e2e/fly.e2e.test.ts`, with real touches): the stick flies while another thumb looks; Land
   gives back the camera; nothing is built; a cancelled touch stops it; upright, sideways and turned over.
   `phone-start` with the wings. The big design's touch lines.
4. Looked at on 390 × 844, 844 × 390, 320 × 568 and a tablet. Still to do by hand: an iPhone and a weak Android.

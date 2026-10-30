# Sprite artwork (2D mode)

Drop PNGs in this folder and list them in `sprites.json` (copy `sprites.example.json` to start).
Anything you don't list keeps using the generated placeholder, so you can add art one piece at a
time. Reload the page to see changes; the browser console lists any file that failed to load.

Turn 2D mode on or off in **Settings → Display → 2D sprite characters**.

## Infected

Keys: `shambler`, `runner`, `bloater`, `screamer`, `brute`, `patientZero` (falls back to `brute`).

- One PNG per animation, frames laid out **left to right in a single row**, all frames the same size.
- Transparent background. Pixels under 50% alpha are cut out (hard edge), so avoid soft halos.
- Draw the character **facing the camera**, feet touching the **bottom edge** of the frame,
  horizontally centred. The game mirrors the sheet when the infected walks across your view.
- `height` is how tall one frame is in the world, in metres (default 2.0). Frame width follows
  the image's aspect ratio. Placeholders use 160×256 px frames (224×256 for Bloater/Brute).
- Animations: `idle`, `walk`, `run`, `attack`, `pain`, `scream`, `death`. Only one is required;
  missing ones fall back (run → walk, scream → attack, death → pain, …).
- `death` plays once and holds its last frame as the corpse, so end on the body lying on the floor.
- Optional `emissive`: a matching sheet that glows in the dark (eyes, pustules). Black = no glow.
- `fps` sets playback speed; walk/run speed up or slow down with how fast the infected moves.

Hit detection still uses the hidden skeleton, so keep the head roughly in the top 12% of the
standing frames to make headshots line up.

## Weapons (first-person)

Keys: `axe`, `pistol`, `smg`, `rifle`, `shotgun`, `dmr`. `idle` is required; `fire` shows for the
muzzle-flash frame and `reload` while reloading. Images are anchored to the bottom of the screen,
right of centre, and scaled to at most 70% of the screen height. Bob, sway, recoil, reload tilt and
swings are applied on top.

## Pickups

Keys: `pickup-1` ammo, `pickup-2` medical, `pickup-3` materials, `pickup-4` lab supplies,
`weapon-<id>`, `key-<item>` (`key-keycard`, `key-sedative`). Pickups are drawn as unlit billboards
about 0.4 m tall (weapons 0.8 m wide).

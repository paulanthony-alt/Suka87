/**
 * Keyboard + mouse state with per-frame edge detection. Keys are tracked by `KeyboardEvent.code`
 * so bindings are layout-independent (WASD stays WASD on AZERTY keyboards).
 */
export class Input {
  private keys = new Set<string>();
  private pressedKeys = new Set<string>();
  private releasedKeys = new Set<string>();
  private buttons = new Set<number>();
  private pressedButtons = new Set<number>();
  private releasedButtons = new Set<number>();

  dx = 0;
  dy = 0;
  wheel = 0;
  locked = false;
  private settle = 0;
  /** When false, gameplay keys are not captured (menus are open). */
  capture = false;

  onLockChange: (locked: boolean) => void = () => {};

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (this.capture && GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressedKeys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.releasedKeys.add(e.code);
    });
    window.addEventListener('blur', () => this.clearHeld());
    el.addEventListener('mousedown', (e) => {
      this.buttons.add(e.button);
      this.pressedButtons.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      if (!this.buttons.has(e.button)) return;
      this.buttons.delete(e.button);
      this.releasedButtons.add(e.button);
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Chrome can report a large bogus delta on the first events after locking.
      if (this.settle > 0) {
        this.settle--;
        return;
      }
      if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (this.locked) this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      this.settle = 2;
      if (!this.locked) this.clearHeld();
      this.onLockChange(this.locked);
    });
  }

  requestLock() {
    if (this.locked) return;
    const p = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
    p?.catch?.(() => {});
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code: string) {
    return this.keys.has(code);
  }
  pressed(code: string) {
    return this.pressedKeys.has(code);
  }
  released(code: string) {
    return this.releasedKeys.has(code);
  }
  mouse(button: number) {
    return this.buttons.has(button);
  }
  mousePressed(button: number) {
    return this.pressedButtons.has(button);
  }
  mouseReleased(button: number) {
    return this.releasedButtons.has(button);
  }

  /** Must be called once at the end of every frame. */
  endFrame() {
    this.pressedKeys.clear();
    this.releasedKeys.clear();
    this.pressedButtons.clear();
    this.releasedButtons.clear();
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
  }

  clearHeld() {
    for (const k of this.keys) this.releasedKeys.add(k);
    for (const b of this.buttons) this.releasedButtons.add(b);
    this.keys.clear();
    this.buttons.clear();
  }
}

const GAME_KEYS = new Set([
  'Tab', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyT',
  'KeyC', 'KeyV', 'KeyB', 'ControlLeft', 'ShiftLeft', 'Digit1', 'Digit2', 'Digit3', 'Digit4',
]);

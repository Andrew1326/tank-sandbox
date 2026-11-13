// Key bindings: every action has two slots, both can be changed in the settings panel and are remembered.
export const ACTIONS = [
  ['forward', 'Drive forward'], ['back', 'Drive back'], ['left', 'Turn left'], ['right', 'Turn right'],
  ['turretLeft', 'Turret left'], ['turretRight', 'Turret right'], ['gunUp', 'Gun up'], ['gunDown', 'Gun down'],
  ['centre', 'Centre turret and gun'], ['fire', 'Fire'], ['boost', 'Speed boost'],
  ['upright', 'Put the tank upright'], ['respawn', 'Back to spawn'], ['meters', 'Driving meters'], ['rays', 'Show suspension'],
] as const;
export type Action = (typeof ACTIONS)[number][0];

const DEFAULTS: Record<Action, [string, string]> = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  turretLeft: ['KeyZ', 'Comma'], turretRight: ['KeyX', 'Period'], gunUp: ['KeyQ', 'PageUp'], gunDown: ['KeyE', 'PageDown'],
  centre: ['KeyC', 'Slash'], fire: ['Space', 'Mouse0'], boost: ['Digit4', 'Numpad4'],
  upright: ['KeyR', ''], respawn: ['KeyT', ''], meters: ['KeyH', ''], rays: ['KeyV', ''],
};
const STORE = 'tank-keys-v1';

const NAMES: Record<string, string> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`',
  ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', AltLeft: 'L Alt', AltRight: 'R Alt',
  Mouse0: 'Left click', Mouse1: 'Middle click', Mouse2: 'Right click', PageUp: 'PgUp', PageDown: 'PgDn', Enter: 'Enter', Tab: 'Tab',
};
export const keyName = (code: string) => (!code ? '—' : NAMES[code] ?? code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num '));

export class Controls {
  binds: Record<Action, [string, string]>;
  private down = new Set<string>();
  private pressed: ((a: Action) => void)[] = [];
  private capture: { action: Action; slot: 0 | 1; el: HTMLElement } | null = null;
  private panel: HTMLElement;
  open = false;

  constructor(private onChange: () => void) {
    this.binds = structuredClone(DEFAULTS);
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null');
      for (const [a] of ACTIONS) if (Array.isArray(saved?.[a]) && saved[a].length === 2) this.binds[a] = [String(saved[a][0]), String(saved[a][1])];
    } catch { /* defaults */ }
    this.panel = document.getElementById('controls')!;
    this.build();

    addEventListener('keydown', (e) => {
      if (this.capture) { e.preventDefault(); this.take(e.code); return; }
      if (e.code === 'Escape') { this.toggle(); return; }
      if (this.open) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return; // typing a name
      if (this.actionsOf(e.code).length) e.preventDefault();
      if (e.repeat) return;
      this.press(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
    const canvas = document.getElementById('c')!;
    addEventListener('pointerdown', (e) => {
      const code = `Mouse${e.button}`;
      if (this.capture) { if ((e.target as HTMLElement).closest('#controls')) { e.preventDefault(); this.take(code); } return; }
      if (e.target === canvas && !this.open) this.press(code);
    });
    addEventListener('pointerup', (e) => this.down.delete(`Mouse${e.button}`));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private actionsOf(code: string): Action[] {
    return ACTIONS.map(([a]) => a).filter((a) => this.binds[a].includes(code));
  }

  private press(code: string) {
    this.down.add(code);
    for (const a of this.actionsOf(code)) for (const cb of this.pressed) cb(a);
  }

  // True while either key for the action is held.
  held(a: Action): boolean {
    return !this.open && this.binds[a].some((c) => c && this.down.has(c));
  }

  axis(pos: Action, neg: Action): number {
    return (this.held(pos) ? 1 : 0) - (this.held(neg) ? 1 : 0);
  }

  onPress(cb: (a: Action) => void) { this.pressed.push(cb); }

  label(a: Action): string {
    return this.binds[a].filter(Boolean).map(keyName).join(' / ') || '—';
  }

  toggle(show = !this.open) {
    this.open = show;
    this.capture = null;
    this.down.clear();
    this.panel.style.display = show ? 'flex' : 'none';
    if (show) this.build();
  }

  private save() {
    try { localStorage.setItem(STORE, JSON.stringify(this.binds)); } catch { /* ignore */ }
    this.onChange();
  }

  private take(code: string) {
    const c = this.capture!;
    this.capture = null;
    if (code !== 'Escape') {
      const value = code === 'Backspace' || code === 'Delete' ? '' : code;
      // A key does one thing: taking it for this action frees it everywhere else.
      if (value) for (const [a] of ACTIONS) this.binds[a] = this.binds[a].map((k) => (k === value ? '' : k)) as [string, string];
      this.binds[c.action][c.slot] = value;
      this.save();
    }
    this.build();
  }

  private build() {
    const rows = ACTIONS.map(([a, label]) =>
      `<div class="row"><span>${label}</span>${[0, 1].map((s) => `<button data-a="${a}" data-s="${s}">${keyName(this.binds[a][s as 0 | 1])}</button>`).join('')}</div>`).join('');
    this.panel.innerHTML = `<div class="box"><h2>Controls</h2><p>Click a slot, then press the key or mouse button for it. Backspace clears a slot, Esc cancels.</p>${rows}
      <div class="foot"><button id="keys-reset">Restore defaults</button><button id="keys-close">Close (Esc)</button></div></div>`;
    this.panel.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.panel.querySelectorAll('button.wait').forEach((x) => x.classList.remove('wait'));
      b.classList.add('wait');
      b.textContent = 'press a key…';
      // Defer so the click that opened the slot is not taken as the new binding.
      setTimeout(() => { this.capture = { action: b.dataset.a as Action, slot: Number(b.dataset.s) as 0 | 1, el: b }; }, 0);
    }));
    this.panel.querySelector('#keys-reset')!.addEventListener('click', () => { this.binds = structuredClone(DEFAULTS); this.save(); this.build(); });
    this.panel.querySelector('#keys-close')!.addEventListener('click', () => this.toggle(false));
  }
}

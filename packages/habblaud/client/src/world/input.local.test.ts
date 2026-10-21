// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { Camera } from './camera';
import { attachInput, type InputHandlers } from './input';

function handlers(): InputHandlers {
  return { pick: () => null, click() {}, doubleClick() {}, hover() {}, interact() {}, overview() {}, zoomStep() {} };
}

describe('local patch: keyboard guard on editable targets', () => {
  let off: (() => void) | null = null;
  afterEach(() => {
    off?.();
    off = null;
    document.body.innerHTML = '';
  });

  function setup(): [number, number][] {
    const pans: [number, number][] = [];
    const camera = { zoom: 1, panBy: (dx: number, dy: number) => pans.push([dx, dy]), zoomAt() {}, settle() {} } as unknown as Camera;
    off = attachInput(document.createElement('canvas'), camera, handlers());
    return pans;
  }

  function press(target: Element, init: KeyboardEventInit = {}): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true, cancelable: true, ...init }));
  }

  it('moves the camera when the target is the body', () => {
    const pans = setup();
    press(document.body);
    expect(pans).toEqual([[0, 90]]);
  });

  it.each(['input', 'textarea', 'select'])('ignores W typed in a <%s>', (tag) => {
    const pans = setup();
    const el = document.createElement(tag);
    document.body.appendChild(el);
    press(el);
    expect(pans).toEqual([]);
  });

  it('ignores W typed in a contenteditable element', () => {
    const pans = setup();
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    document.body.appendChild(el);
    press(el);
    expect(pans).toEqual([]);
  });

  it.each(['ctrlKey', 'metaKey', 'altKey'] as const)('ignores a key combined with %s', (mod) => {
    const pans = setup();
    press(document.body, { [mod]: true });
    expect(pans).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWorldAssets, packDir } from './assets';

const CLASSIC = {
  wallArt: [{ id: 'painting-a', kind: 'painting', file: 'art/painting-a.png', w: 26, h: 16, tiles: 2 }],
  brand: { signage: { file: 'brand/signage.png', w: 40, h: 10 } },
};
const PACK = {
  wallArt: [
    { id: 'painting-b', kind: 'painting', file: 'art/painting-b.png', w: 26, h: 16, tiles: 2, framed: { file: 'art/framed/painting-b.png', w: 32, h: 22 } },
    { id: 'poster-cat', kind: 'poster', variant: 'cat', file: 'art/poster-cat.png', w: 12, h: 16, tiles: 1 },
  ],
  brand: { signage: { file: 'brand/other.png', w: 40, h: 10 } },
};

let loaded: string[] = [];

class FakeImage {
  decoding = '';
  naturalWidth = 0;
  naturalHeight = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(v: string) {
    loaded.push(v);
    queueMicrotask(() => {
      if (v.includes('missing')) {
        this.onerror?.();
        return;
      }
      this.naturalWidth = 26;
      this.naturalHeight = 16;
      this.onload?.();
    });
  }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function serve(routes: Record<string, unknown>): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (url in routes ? json(routes[url]) : new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }))));
}

describe('local patch D: theme pack wall art', () => {
  beforeEach(() => {
    loaded = [];
    vi.stubGlobal('Image', FakeImage);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the classic manifest without a pack', async () => {
    serve({ '/assets/manifest.json': CLASSIC });
    const a = await loadWorldAssets();
    expect(a?.wallArt.map((w) => w.id)).toEqual(['painting-a']);
    expect(a?.signage).toBeDefined();
    expect(loaded).toContain('/assets/art/painting-a.png');
  });

  it('takes wall art from the pack, resolved against its folder, and the brand from classic', async () => {
    serve({ '/assets/manifest.json': CLASSIC, '/assets/themes/japandi/manifest.json': PACK });
    const a = await loadWorldAssets(undefined, { pack: 'themes/japandi' });
    expect(a?.wallArt.map((w) => w.id)).toEqual(['painting-b', 'poster-cat']);
    expect(a?.wallArt[0]?.framed).toBeDefined();
    expect(loaded).toContain('/assets/themes/japandi/art/painting-b.png');
    expect(loaded).toContain('/assets/themes/japandi/art/framed/painting-b.png');
    expect(loaded).toContain('/assets/brand/signage.png');
    expect(loaded).not.toContain('/assets/themes/japandi/brand/other.png');
    expect(loaded).not.toContain('/assets/art/painting-a.png');
  });

  it('falls back to the classic art when the pack manifest is missing or empty', async () => {
    serve({ '/assets/manifest.json': CLASSIC, '/assets/themes/empty/manifest.json': { wallArt: [] } });
    for (const pack of ['themes/gone', 'themes/empty']) {
      loaded = [];
      const a = await loadWorldAssets(undefined, { pack });
      expect(a?.wallArt.map((w) => w.id)).toEqual(['painting-a']);
      expect(loaded).toContain('/assets/art/painting-a.png');
    }
  });

  it('ignores a pack path that could leave the assets folder', async () => {
    serve({ '/assets/manifest.json': CLASSIC });
    expect(packDir('../x')).toBeNull();
    expect(packDir('themes/../x')).toBeNull();
    expect(packDir('/themes/x')).toBeNull();
    expect(packDir('themes/forest-cabin')).toBe('themes/forest-cabin');
    const a = await loadWorldAssets(undefined, { pack: '../secret' });
    expect(a?.wallArt.map((w) => w.id)).toEqual(['painting-a']);
    expect((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c[0])).toEqual(['/assets/manifest.json']);
  });
});

import { describe, expect, it } from 'vitest';
import { ACTOR_GLYPHS, actorGlyph } from './glyphs';

describe('actorGlyph', () => {
  it('文字は HP で変わらない', () => {
    for (const health of ['healthy', 'hurt', 'critical'] as const) {
      expect(actorGlyph('goblin', health).ch).toBe(ACTOR_GLYPHS.goblin.ch);
    }
  });

  it('無傷なら種類の色のまま', () => {
    expect(actorGlyph('goblin', 'healthy').fg).toBe(ACTOR_GLYPHS.goblin.fg);
  });

  it('傷つくほど赤に寄る', () => {
    const red = (hex: string): number => parseInt(hex.slice(1, 3), 16);
    const green = (hex: string): number => parseInt(hex.slice(3, 5), 16);
    const healthy = actorGlyph('goblin', 'healthy').fg;
    const hurt = actorGlyph('goblin', 'hurt').fg;
    const critical = actorGlyph('goblin', 'critical').fg;
    expect(red(hurt)).toBeGreaterThan(red(healthy));
    expect(red(critical)).toBeGreaterThan(red(hurt));
    expect(green(critical)).toBeLessThan(green(hurt));
  });

  it('プレイヤーの色は変えない', () => {
    for (const health of ['healthy', 'hurt', 'critical'] as const) {
      expect(actorGlyph('player', health)).toEqual(ACTOR_GLYPHS.player);
    }
  });

  it('色は #rrggbb の形を保つ', () => {
    expect(actorGlyph('dragon', 'critical').fg).toMatch(/^#[0-9a-f]{6}$/);
  });
});

import { afterEach, expect, it, vi } from 'vitest';
import { Sound } from '../../src/systems/audio';

afterEach(() => vi.unstubAllGlobals());
it('does not create audio before a gesture or while muted, and tolerates missing audio', () => {
  const Context = vi.fn(() => { throw new Error('Audio unavailable'); });
  vi.stubGlobal('AudioContext', Context);
  const sound = new Sound(); sound.play('snap'); expect(Context).not.toHaveBeenCalled();
  sound.muted = true; sound.unlock(); expect(Context).not.toHaveBeenCalled();
  sound.muted = false; expect(() => sound.unlock()).not.toThrow(); expect(Context).toHaveBeenCalledTimes(1);
  expect(() => sound.play('success')).not.toThrow(); sound.dispose();
});

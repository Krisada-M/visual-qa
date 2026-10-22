import { describe, expect, it } from 'vitest';
import { MappingIndexSchema, suggestMappings } from './mapping.js';

describe('Figma-to-route mapping suggestions', () => {
  it('ranks matching routes but never auto-confirms', () => {
    const input = MappingIndexSchema.parse({
      frames: [{ id: 'F:123', name: 'Membership dashboard', state: 'default' }],
      screens: [
        { id: 'login', name: 'Staff login', state: 'default', path: '/staff/login' },
        { id: 'member', name: 'Membership dashboard', state: 'default', path: '/member/dashboard' },
      ],
    });
    const candidates = suggestMappings(input);
    expect(candidates[0]?.runtimePath).toBe('/member/dashboard');
    expect(candidates[0]?.confirmed).toBe(false);
  });

  it('does not make up a mapping when there are no meaningful matches', () => {
    const input = MappingIndexSchema.parse({
      frames: [{ id: 'F:5', name: 'Cart', state: 'error' }],
      screens: [{ id: 'home', name: 'Dashboard', state: 'default', path: '/dashboard' }],
    });
    expect(suggestMappings(input)).toEqual([]);
  });
});

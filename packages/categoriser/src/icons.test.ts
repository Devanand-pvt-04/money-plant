import { describe, expect, it } from 'vitest';
import { DEFAULT_ICON, iconForName, resolveLook } from './icons';

describe('category icons', () => {
  it('picks an icon from a word in the name', () => {
    expect(iconForName('Car')).toEqual({ icon: 'car', colorKey: 'transport' });
    expect(iconForName('Petrol and CNG')?.icon).toBe('gas-station');
    expect(iconForName('Gyms')?.icon).toBe('dumbbell');
    expect(iconForName('Misc')).toBeNull();
  });

  it('prefers the icon the user picked', () => {
    expect(resolveLook({ key: 'custom', name: 'Car', icon: 'motorbike' }).icon).toBe('motorbike');
  });

  it('follows a renamed default category', () => {
    expect(resolveLook({ key: 'transport', name: 'Transport', icon: null }).icon).toBe('bus');
    expect(resolveLook({ key: 'transport', name: 'Fuel', icon: null })).toEqual({ icon: 'gas-station', colorKey: 'transport' });
  });

  it('gives a user-made category the colours its name suggests', () => {
    expect(resolveLook({ key: 'custom', name: 'Car', icon: null })).toEqual({ icon: 'car', colorKey: 'transport' });
    expect(resolveLook({ key: 'custom', name: 'Misc', icon: null })).toEqual({ icon: DEFAULT_ICON, colorKey: null });
  });

  it('lets a sub-category with no matching name look like its parent', () => {
    const car = { key: 'custom', name: 'Car', icon: null };
    expect(resolveLook({ key: 'custom', name: 'Insurance', icon: null, parent: car })).toEqual({ icon: 'shield-check', colorKey: 'transport' });
    expect(resolveLook({ key: 'custom', name: 'Odds', icon: null, parent: car })).toEqual({ icon: 'car', colorKey: 'transport' });
    expect(resolveLook({ key: 'food.custom', name: 'Breakfast', icon: null, parent: { key: 'food', name: 'Food', icon: null } })).toEqual({
      icon: 'coffee',
      colorKey: 'food',
    });
  });
});

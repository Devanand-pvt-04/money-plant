import { describe, expect, it } from 'vitest';
import { DEFAULT_ICON, iconForName, iconInSet, resolveLook, searchIcons } from './icons';

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

describe('icons from the whole set', () => {
  const names = ['badminton', 'table-tennis', 'tennis', 'dumbbell', 'guitar-acoustic', 'home', 'tag', 'cricket', 'swim', 'theater'];
  const set = new Set(names);
  it('finds an icon by name or other name, past words that say nothing', () => {
    expect(iconInSet('Badminton', set)).toBe('badminton');
    expect(iconInSet('Table tennis', set)).toBe('table-tennis');
    expect(iconInSet('Cricket matches', set)).toBe('cricket');
    expect(iconInSet('Other expenses', set)).toBeNull();
  });
  it('uses the set only when the keyword list has nothing', () => {
    expect(resolveLook({ key: 'custom', name: 'Badminton', icon: null }, set).icon).toBe('badminton');
    expect(resolveLook({ key: 'custom', name: 'Pottery classes', icon: null }, new Set(['swim'])).icon).toBe('tag');
    expect(resolveLook({ key: 'custom', name: 'Swim', icon: null }, set).icon).toBe('swim');
    expect(resolveLook({ key: 'custom', name: 'Gym', icon: null }, set).icon).toBe('dumbbell');
  });
  it('searches names, parts of names and other names', () => {
    expect(searchIcons('tennis', names)).toEqual(['tennis', 'table-tennis']);
    expect(searchIcons('guitar', names)).toEqual(['guitar-acoustic']);
    expect(searchIcons('', names)).toEqual([]);
  });
});

describe('icon names that start with a word', () => {
  it('falls back to the shortest icon named after a word', () => {
    const names = ['guitar-acoustic', 'guitar-electric', 'guitar-pick'];
    const set = { has: (n: string) => names.includes(n), firstStartingWith: (w: string) => names.filter((n) => n.startsWith(`${w}-`)).sort((a, b) => a.length - b.length)[0] ?? null };
    expect(iconInSet('Guitar class', set)).toBe('guitar-pick');
  });
});

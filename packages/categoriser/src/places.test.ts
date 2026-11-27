import { describe, expect, it } from 'vitest';
import { groupPlaces } from './places';

describe('groupPlaces', () => {
  it('counts every spelling of a known shop once, under its name', () => {
    const labels = ['AMAZON PAY INDI', 'AMAZON PAY IN E', 'AMAZON PAY IN E', 'Amazon India', 'AMAZON'];
    const place = groupPlaces(labels);
    expect(new Set(labels.map((l) => place(l).key)).size).toBe(1);
    expect(place('AMAZON').name).toBe('Amazon');
  });

  it('groups names where one starts the other, taking the most used spelling', () => {
    const place = groupPlaces(['RENTOK', 'RENTOK TECHNOLOGIES PVT', 'Rentok']);
    expect(place('RENTOK TECHNOLOGIES PVT').key).toBe(place('Rentok').key);
    expect(place('Rentok').name).toBe('RENTOK');
  });

  it('keeps different shops apart and never guesses at spellings', () => {
    const place = groupPlaces(['Google Pay', 'Google Play', 'Ravi Kumar', 'Ravi Stores']);
    expect(place('Google Pay').key).not.toBe(place('Google Play').key);
    expect(place('Ravi Kumar').key).not.toBe(place('Ravi Stores').key);
  });

  it('does not merge kinds of place, like two petrol pumps', () => {
    const place = groupPlaces(['Indian Oil Corp', 'HPCL Petrol Pump']);
    expect(place('Indian Oil Corp').key).not.toBe(place('HPCL Petrol Pump').key);
  });

  it('needs four letters before a name absorbs longer ones', () => {
    const place = groupPlaces(['ABC', 'ABC Bakery']);
    expect(place('ABC').key).not.toBe(place('ABC Bakery').key);
  });

  it('puts entries without a payee under Unknown', () => {
    const place = groupPlaces([null, '  ']);
    expect(place(null)).toEqual({ key: 'unknown', name: 'Unknown' });
  });
});

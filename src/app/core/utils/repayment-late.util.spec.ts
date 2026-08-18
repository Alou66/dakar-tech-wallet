import { computeDaysLate } from './repayment-late.util';

const NOW = new Date('2026-08-15T00:00:00.000Z');

describe('computeDaysLate', () => {
  it('retourne 0 quand la date est dans le futur', () => {
    expect(computeDaysLate('2026-09-01T00:00:00.000Z', NOW)).toBe(0);
  });

  it("retourne 0 le jour même de l'échéance", () => {
    expect(computeDaysLate('2026-08-15T00:00:00.000Z', NOW)).toBe(0);
  });

  it('calcule 1 jour de retard', () => {
    expect(computeDaysLate('2026-08-14T00:00:00.000Z', NOW)).toBe(1);
  });

  it('calcule un retard important', () => {
    expect(computeDaysLate('2026-06-01T00:00:00.000Z', NOW)).toBe(75);
  });
});

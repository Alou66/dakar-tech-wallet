import { scheduleTotalDue } from './loan-schedule.util';

describe('scheduleTotalDue', () => {
  it('multiplie la mensualité par la durée', () => {
    expect(scheduleTotalDue({ monthlyPayment: 52500, durationMonths: 4 })).toBe(210000);
  });
});

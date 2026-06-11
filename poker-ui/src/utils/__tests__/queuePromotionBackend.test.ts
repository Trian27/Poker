import { describe, expect, it } from 'vitest';

import { getBackendPromotionObservation } from '../queuePromotionBackend';

describe('getBackendPromotionObservation', () => {
  it('treats queue removal plus seat and session persistence as promotion truth', () => {
    const observation = getBackendPromotionObservation({
      queueEntries: [],
      activeSessions: [
        {
          user_id: 6,
          table_id: 2,
          buy_in_amount: '350',
        },
      ],
      seats: [
        { seat_number: 1, user_id: 6 },
        { seat_number: 2, user_id: 5 },
      ],
      reservedBuyInAmount: 350,
      tableId: 2,
      userId: 6,
    });

    expect(observation).toEqual({
      observed: true,
      promotedSeatNumber: 1,
    });
  });

  it('does not report promotion while the player is still queued', () => {
    const observation = getBackendPromotionObservation({
      queueEntries: [
        {
          userId: '6',
          position: 1,
          reservedBuyInAmount: 350,
        },
      ],
      activeSessions: [
        {
          user_id: 6,
          table_id: 2,
          buy_in_amount: 350,
        },
      ],
      seats: [
        { seat_number: 1, user_id: 6 },
      ],
      reservedBuyInAmount: 350,
      tableId: 2,
      userId: 6,
    });

    expect(observation).toEqual({
      observed: false,
      promotedSeatNumber: null,
    });
  });
});

export type BackendPromotionQueueEntry = {
  userId: string;
  position: number;
  reservedBuyInAmount: number | null;
};

export type BackendPromotionSession = {
  user_id: unknown;
  table_id: unknown;
  buy_in_amount: unknown;
};

export type BackendPromotionSeat = {
  seat_number: unknown;
  user_id: unknown;
};

export type BackendPromotionObservation = {
  observed: boolean;
  promotedSeatNumber: number | null;
};

type BackendPromotionInput = {
  queueEntries: BackendPromotionQueueEntry[];
  activeSessions: BackendPromotionSession[];
  seats: BackendPromotionSeat[];
  reservedBuyInAmount: number;
  tableId: number;
  userId: number;
};

export const getBackendPromotionObservation = ({
  queueEntries,
  activeSessions,
  seats,
  reservedBuyInAmount,
  tableId,
  userId,
}: BackendPromotionInput): BackendPromotionObservation => {
  const ownQueueEntry = queueEntries.find((entry) => entry.userId === String(userId));
  const promotedSession = activeSessions.find((entry) => (
    Number(entry.user_id) === userId
    && Number(entry.table_id) === tableId
    && Number(entry.buy_in_amount) === reservedBuyInAmount
  ));
  const promotedSeat = seats.find((seat) => Number(seat.user_id) === userId);

  if (!ownQueueEntry && promotedSession && promotedSeat) {
    return {
      observed: true,
      promotedSeatNumber: Number(promotedSeat.seat_number),
    };
  }

  return {
    observed: false,
    promotedSeatNumber: null,
  };
};

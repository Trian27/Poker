import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAutoRejoinSuppressionForUser,
  clearAutoRejoinSuppressionForUserTable,
  isAutoRejoinSuppressedForUserTable,
  suppressAutoRejoinForUserTable,
} from '../activeSeatRejoin';

describe('activeSeatRejoin suppression', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('stores and clears user-table scoped suppression with normalized ids', () => {
    suppressAutoRejoinForUserTable('7', 11, 60_000);

    expect(isAutoRejoinSuppressedForUserTable(7, '11')).toBe(true);

    clearAutoRejoinSuppressionForUserTable(7, 11);
    expect(isAutoRejoinSuppressedForUserTable(7, 11)).toBe(false);
  });

  it('does not suppress a different table for the same user', () => {
    suppressAutoRejoinForUserTable(7, 11, 60_000);

    expect(isAutoRejoinSuppressedForUserTable(7, 12)).toBe(false);
  });

  it('does not suppress a different user on the same table', () => {
    suppressAutoRejoinForUserTable(7, 11, 60_000);

    expect(isAutoRejoinSuppressedForUserTable(8, 11)).toBe(false);
  });

  it('expires suppression entries opportunistically', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000);
    suppressAutoRejoinForUserTable(7, 11, 500);

    nowSpy.mockReturnValue(2_000);
    expect(isAutoRejoinSuppressedForUserTable(7, 11)).toBe(false);
  });

  it('clears all suppression entries for the current user', () => {
    suppressAutoRejoinForUserTable(7, 11, 60_000);
    suppressAutoRejoinForUserTable(7, 12, 60_000);
    suppressAutoRejoinForUserTable(8, 11, 60_000);

    clearAutoRejoinSuppressionForUser(7);

    expect(isAutoRejoinSuppressedForUserTable(7, 11)).toBe(false);
    expect(isAutoRejoinSuppressedForUserTable(7, 12)).toBe(false);
    expect(isAutoRejoinSuppressedForUserTable(8, 11)).toBe(true);
  });
});

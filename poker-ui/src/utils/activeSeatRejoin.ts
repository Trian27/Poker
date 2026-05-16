const AUTO_REJOIN_SUPPRESSION_KEY = 'poker:autoRejoinSuppression:v2';
const RELOAD_REJOIN_CHECKED_KEY = 'poker:reloadRejoinChecked';

type SuppressionEntry = {
  userId: string;
  tableId: string;
  until: number;
};

type SuppressionMap = Record<string, SuppressionEntry>;

const getNow = () => Date.now();

const normalizeId = (value: string | number | null | undefined): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

const makeKey = (userId: string, tableId: string): string => `${userId}:${tableId}`;

const readSuppressionMap = (): SuppressionMap => {
  if (typeof window === 'undefined') {
    return {};
  }

  const rawValue = window.sessionStorage.getItem(AUTO_REJOIN_SUPPRESSION_KEY);
  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue) as SuppressionMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    window.sessionStorage.removeItem(AUTO_REJOIN_SUPPRESSION_KEY);
    return {};
  }
};

const writeSuppressionMap = (entries: SuppressionMap): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const keys = Object.keys(entries);
  if (keys.length === 0) {
    window.sessionStorage.removeItem(AUTO_REJOIN_SUPPRESSION_KEY);
    return;
  }

  window.sessionStorage.setItem(AUTO_REJOIN_SUPPRESSION_KEY, JSON.stringify(entries));
};

const pruneExpiredEntries = (entries: SuppressionMap): SuppressionMap => {
  const now = getNow();
  const nextEntries: SuppressionMap = {};

  for (const [key, entry] of Object.entries(entries)) {
    if (
      !entry
      || typeof entry !== 'object'
      || typeof entry.until !== 'number'
      || entry.until <= now
      || !normalizeId(entry.userId)
      || !normalizeId(entry.tableId)
    ) {
      continue;
    }
    nextEntries[key] = {
      userId: normalizeId(entry.userId)!,
      tableId: normalizeId(entry.tableId)!,
      until: entry.until,
    };
  }

  return nextEntries;
};

const readPrunedEntries = (): SuppressionMap => {
  const currentEntries = readSuppressionMap();
  const prunedEntries = pruneExpiredEntries(currentEntries);
  if (JSON.stringify(currentEntries) !== JSON.stringify(prunedEntries)) {
    writeSuppressionMap(prunedEntries);
  }
  return prunedEntries;
};

export const suppressAutoRejoinForUserTable = (
  userId: string | number | null | undefined,
  tableId: string | number | null | undefined,
  durationMs: number = 2 * 60 * 1000,
): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const normalizedUserId = normalizeId(userId);
  const normalizedTableId = normalizeId(tableId);
  if (!normalizedUserId || !normalizedTableId) {
    return;
  }

  const entries = readPrunedEntries();
  const key = makeKey(normalizedUserId, normalizedTableId);
  entries[key] = {
    userId: normalizedUserId,
    tableId: normalizedTableId,
    until: getNow() + Math.max(0, durationMs),
  };
  writeSuppressionMap(entries);
};

export const isAutoRejoinSuppressedForUserTable = (
  userId: string | number | null | undefined,
  tableId: string | number | null | undefined,
): boolean => {
  const normalizedUserId = normalizeId(userId);
  const normalizedTableId = normalizeId(tableId);
  if (!normalizedUserId || !normalizedTableId) {
    return false;
  }

  const entries = readPrunedEntries();
  return Boolean(entries[makeKey(normalizedUserId, normalizedTableId)]);
};

export const clearAutoRejoinSuppressionForUserTable = (
  userId: string | number | null | undefined,
  tableId: string | number | null | undefined,
): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const normalizedUserId = normalizeId(userId);
  const normalizedTableId = normalizeId(tableId);
  if (!normalizedUserId || !normalizedTableId) {
    return;
  }

  const entries = readPrunedEntries();
  delete entries[makeKey(normalizedUserId, normalizedTableId)];
  writeSuppressionMap(entries);
};

export const clearAutoRejoinSuppressionForUser = (
  userId: string | number | null | undefined,
): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const normalizedUserId = normalizeId(userId);
  if (!normalizedUserId) {
    return;
  }

  const entries = readPrunedEntries();
  const nextEntries = Object.fromEntries(
    Object.entries(entries).filter(([, entry]) => normalizeId(entry.userId) !== normalizedUserId),
  );
  writeSuppressionMap(nextEntries);
};

export const shouldRunReloadAutoRejoinCheck = (isReload: boolean): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  if (!isReload) {
    return false;
  }
  return window.sessionStorage.getItem(RELOAD_REJOIN_CHECKED_KEY) !== '1';
};

export const markReloadAutoRejoinCheckComplete = (): void => {
  if (typeof window === 'undefined') {
    return;
  }
  window.sessionStorage.setItem(RELOAD_REJOIN_CHECKED_KEY, '1');
};

export const resetReloadAutoRejoinCheck = (): void => {
  if (typeof window === 'undefined') {
    return;
  }
  window.sessionStorage.removeItem(RELOAD_REJOIN_CHECKED_KEY);
};

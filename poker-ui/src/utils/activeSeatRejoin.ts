const AUTO_REJOIN_SUPPRESS_UNTIL_KEY = 'poker:autoRejoinSuppressUntil';
const RELOAD_REJOIN_CHECKED_KEY = 'poker:reloadRejoinChecked';

const getNow = () => Date.now();

export const suppressAutoRejoinForMs = (durationMs: number = 2 * 60 * 1000): void => {
  if (typeof window === 'undefined') {
    return;
  }
  const until = getNow() + Math.max(0, durationMs);
  window.sessionStorage.setItem(AUTO_REJOIN_SUPPRESS_UNTIL_KEY, String(until));
};

export const isAutoRejoinSuppressed = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  const rawUntil = window.sessionStorage.getItem(AUTO_REJOIN_SUPPRESS_UNTIL_KEY);
  if (!rawUntil) {
    return false;
  }
  const until = Number(rawUntil);
  if (!Number.isFinite(until) || until <= getNow()) {
    window.sessionStorage.removeItem(AUTO_REJOIN_SUPPRESS_UNTIL_KEY);
    return false;
  }
  return true;
};

export const clearAutoRejoinSuppression = (): void => {
  if (typeof window === 'undefined') {
    return;
  }
  window.sessionStorage.removeItem(AUTO_REJOIN_SUPPRESS_UNTIL_KEY);
};

export const shouldRunReloadAutoRejoinCheck = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  const alreadyChecked = window.sessionStorage.getItem(RELOAD_REJOIN_CHECKED_KEY) === '1';
  if (alreadyChecked) {
    return false;
  }
  window.sessionStorage.setItem(RELOAD_REJOIN_CHECKED_KEY, '1');
  return true;
};

export const resetReloadAutoRejoinCheck = (): void => {
  if (typeof window === 'undefined') {
    return;
  }
  window.sessionStorage.removeItem(RELOAD_REJOIN_CHECKED_KEY);
};

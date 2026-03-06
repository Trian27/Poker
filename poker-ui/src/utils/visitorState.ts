const VISITOR_COOKIE_NAME = 'dormstacks_seen';
const VISITOR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year
const POST_SIGNUP_TUTORIAL_KEY = 'dormstacks_tutorial_after_signup';

const getCookieMap = (): Record<string, string> => {
  if (typeof document === 'undefined') {
    return {};
  }

  return document.cookie
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, cookiePair) => {
      const [rawName, ...valueParts] = cookiePair.split('=');
      if (!rawName) {
        return acc;
      }
      acc[decodeURIComponent(rawName)] = decodeURIComponent(valueParts.join('='));
      return acc;
    }, {});
};

export const hasSeenDormstacks = (): boolean => {
  const cookies = getCookieMap();
  return cookies[VISITOR_COOKIE_NAME] === '1';
};

export const markDormstacksSeen = (): void => {
  if (typeof document === 'undefined') {
    return;
  }
  document.cookie = `${VISITOR_COOKIE_NAME}=1; max-age=${VISITOR_COOKIE_MAX_AGE_SECONDS}; path=/; samesite=lax`;
};

export const setPostSignupTutorialPending = (pending: boolean): void => {
  if (typeof window === 'undefined') {
    return;
  }
  if (pending) {
    window.localStorage.setItem(POST_SIGNUP_TUTORIAL_KEY, '1');
  } else {
    window.localStorage.removeItem(POST_SIGNUP_TUTORIAL_KEY);
  }
};

export const consumePostSignupTutorialPending = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  const isPending = window.localStorage.getItem(POST_SIGNUP_TUTORIAL_KEY) === '1';
  if (isPending) {
    window.localStorage.removeItem(POST_SIGNUP_TUTORIAL_KEY);
  }
  return isPending;
};

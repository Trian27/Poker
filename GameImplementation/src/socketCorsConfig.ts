const LOCAL_UI_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

export const parseAllowedOrigins = (value?: string | null): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
};

export const resolveSocketCorsOrigin = (
  nodeEnv?: string,
  configuredOrigins?: string | null,
): string[] | RegExp => {
  const parsedOrigins = parseAllowedOrigins(configuredOrigins);
  if (parsedOrigins.length > 0) {
    return parsedOrigins;
  }

  if ((nodeEnv || '').toLowerCase() === 'production') {
    return [];
  }

  return LOCAL_UI_ORIGIN_PATTERN;
};

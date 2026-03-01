import axios from 'axios';

type ApiErrorPayload = {
  detail?: unknown;
  error?: unknown;
  message?: unknown;
};

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const getApiErrorMessage = (error: unknown, fallback: string): string => {
  if (axios.isAxiosError(error)) {
    const responseData = error.response?.data;
    const directMessage = asNonEmptyString(responseData);
    if (directMessage) {
      return directMessage;
    }

    if (responseData && typeof responseData === 'object') {
      const payload = responseData as ApiErrorPayload;
      const detail = asNonEmptyString(payload.detail);
      if (detail) {
        return detail;
      }
      const errorMessage = asNonEmptyString(payload.error);
      if (errorMessage) {
        return errorMessage;
      }
      const message = asNonEmptyString(payload.message);
      if (message) {
        return message;
      }
    }

    const axiosMessage = asNonEmptyString(error.message);
    if (axiosMessage) {
      return axiosMessage;
    }
  }

  if (error instanceof Error) {
    const message = asNonEmptyString(error.message);
    if (message) {
      return message;
    }
  }

  return fallback;
};

export const getApiErrorStatus = (error: unknown): number | null => {
  if (!axios.isAxiosError(error)) {
    return null;
  }
  const status = error.response?.status;
  return typeof status === 'number' ? status : null;
};

export interface ErrorDetails {
  name: string;
  message: string;
  code: string | number | null;
  stack: string | null;
  cause: ErrorDetails | string | null;
}

export function errorDetails(error: unknown, depth = 0): ErrorDetails {
  if (!(error instanceof Error)) {
    return {
      name: typeof error,
      message: String(error),
      code: null,
      stack: null,
      cause: null,
    };
  }
  const code = "code" in error &&
      (typeof error.code === "string" || typeof error.code === "number")
    ? error.code
    : null;
  return {
    name: error.name,
    message: error.message,
    code,
    stack: error.stack ?? null,
    cause: error.cause === undefined
      ? null
      : error.cause instanceof Error && depth < 5
        ? errorDetails(error.cause, depth + 1)
        : String(error.cause),
  };
}

type ErrorConstructor = new (...args: unknown[]) => Error;

type SentryOptions = {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
};

export function catchErrors<T>(
  fn: () => T,
  errorsToHandle?: ErrorConstructor[],
  sentryOptions?: SentryOptions,
): T;
export function catchErrors<T>(
  fn: () => Promise<T>,
  errorsToHandle?: ErrorConstructor[],
  sentryOptions?: SentryOptions,
): Promise<T>;
export function catchErrors<T>(
  fn: () => T | Promise<T>,
  errorsToHandle: ErrorConstructor[] = [],
  _sentryOptions?: SentryOptions,
): T | Promise<T> {
  try {
    const result = fn();

    if (result instanceof Promise) {
      return result.catch((error) => {
        if (shouldHandle(error, errorsToHandle)) {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          return undefined as T;
        }
        console.error(error);
        throw error;
      });
    }

    return result;
  } catch (error) {
    if (shouldHandle(error, errorsToHandle)) {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return undefined as T;
    }
    console.error(error);
    throw error;
  }
}

function shouldHandle(error: unknown, errorsToHandle: ErrorConstructor[]) {
  if (errorsToHandle.length === 0) return true;
  return errorsToHandle.some((ErrorClass) => error instanceof ErrorClass);
}

export type ServerActionFlattenedError = {
  readonly fieldErrors: Record<string, string[]>;
  readonly formErrors: string[];
};

export type ServerActionError = {
  readonly success: false;
  readonly error: ServerActionFlattenedError;
};

export function serverActionError({
  fieldErrors,
  formErrors,
}: {
  readonly fieldErrors?: Record<string, string[]>;
  readonly formErrors?: string[];
}): ServerActionError {
  return {
    success: false,
    error: {
      fieldErrors: fieldErrors ?? {},
      formErrors: formErrors ?? [],
    },
  };
}

import { NextResponse } from "next/server";

type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export function apiSuccess<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function apiListSuccess<T>(data: T[], meta: { page: number; perPage: number; total: number }) {
  return NextResponse.json({ data, meta });
}

export function apiError(code: ApiErrorCode, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export function unauthorized(message = "Invalid or missing API key") {
  return apiError("UNAUTHORIZED", message, 401);
}

export function forbidden(message = "You do not have access to this resource") {
  return apiError("FORBIDDEN", message, 403);
}

export function notFound(message = "Resource not found") {
  return apiError("NOT_FOUND", message, 404);
}

export function validationError(message: string, details?: unknown) {
  return apiError("VALIDATION_ERROR", message, 400, details);
}

export function conflict(message: string) {
  return apiError("CONFLICT", message, 409);
}

import { getToken, getRegistryUrl } from "./config.js";

type ApiResponse<T> = {
  data: T;
};

type ApiListResponse<T> = {
  data: T[];
  meta: { page: number; perPage: number; total: number };
};

type ApiError = {
  error: { code: string; message: string; details?: unknown };
};

export class ApiRequestError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(`${code}: ${message}`);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = getToken();
  if (token) {
    h["Authorization"] = `Bearer ${token}`;
  }
  return h;
}

async function handleResponse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const err = body as ApiError | null;
    throw new ApiRequestError(
      res.status,
      err?.error?.code ?? "HTTP_ERROR",
      err?.error?.message ?? res.statusText,
      err?.error?.details,
    );
  }

  return body as T;
}

export async function get<T>(path: string): Promise<ApiResponse<T>> {
  const res = await fetch(`${getRegistryUrl()}${path}`, {
    method: "GET",
    headers: headers(),
  });
  return handleResponse(res);
}

export async function getList<T>(path: string): Promise<ApiListResponse<T>> {
  const res = await fetch(`${getRegistryUrl()}${path}`, {
    method: "GET",
    headers: headers(),
  });
  return handleResponse(res);
}

export async function post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
  const res = await fetch(`${getRegistryUrl()}${path}`, {
    method: "POST",
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  return handleResponse(res);
}

export async function del<T>(path: string): Promise<ApiResponse<T>> {
  const res = await fetch(`${getRegistryUrl()}${path}`, {
    method: "DELETE",
    headers: headers(),
  });
  return handleResponse(res);
}

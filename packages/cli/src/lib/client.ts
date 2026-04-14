import { getToken, getRegistryUrl } from "./config.js";
import { error } from "./output.js";

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
  const body = await res.json();

  if (!res.ok) {
    const err = body as ApiError;
    error(`${err.error.code}: ${err.error.message}`);
    process.exit(1);
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

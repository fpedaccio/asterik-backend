"use client";

import { getSupabase } from "./supabase";

export type Engine = "gemini" | "hybrid";
export type Visibility = "public" | "private";

export interface UploadSignResponse {
  upload_url: string;
  source_path: string;
  token?: string | null;
}

export interface GenerationResponse {
  id: string;
  status: "pending" | "done" | "error";
  engine: Engine;
  prompt_used: string;
  source_path: string;
  output_path: string | null;
  output_url: string | null;
  error: string | null;
  elapsed_ms: number | null;
  created_at: string;
}

export interface FilterResponse {
  id: string;
  owner_id: string;
  name: string;
  prompt: string;
  description: string | null;
  engine: Engine;
  params: Record<string, unknown> | null;
  preview_url: string | null;
  visibility: Visibility;
  created_at: string;
  likes_count: number;
  uses_count: number;
  liked_by_me: boolean;
  favorited_by_me: boolean;
}

export type FilterScope = "top" | "new" | "favorites" | "mine" | "public";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function authHeader(): Promise<HeadersInit> {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");
  return { Authorization: `Bearer ${token}` };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = {
    "Content-Type": "application/json",
    ...(await authHeader()),
    ...(init.headers ?? {}),
  };
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// -------- Uploads --------
export async function signUpload(contentType: string): Promise<UploadSignResponse> {
  return request<UploadSignResponse>("/api/uploads/sign", {
    method: "POST",
    body: JSON.stringify({ content_type: contentType }),
  });
}

export async function uploadToSignedUrl(
  signedUrl: string,
  file: File | Blob
): Promise<void> {
  const res = await fetch(signedUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
  }
}

// -------- Generations --------
export async function createGeneration(input: {
  source_path: string;
  engine: Engine;
  prompt?: string;
  filter_id?: string;
}): Promise<GenerationResponse> {
  return request<GenerationResponse>("/api/generations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// -------- Filters --------
export async function listFilters(scope: FilterScope): Promise<FilterResponse[]> {
  return request<FilterResponse[]>(`/api/filters?scope=${scope}`);
}

export async function getFilter(id: string): Promise<FilterResponse> {
  return request<FilterResponse>(`/api/filters/${id}`);
}

export async function createFilter(input: {
  name: string;
  prompt: string;
  description?: string;
  engine: Engine;
  visibility: Visibility;
  preview_generation_id?: string;
  params?: Record<string, unknown>;
}): Promise<FilterResponse> {
  return request<FilterResponse>("/api/filters", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateFilter(
  id: string,
  input: { name?: string; description?: string; visibility?: Visibility }
): Promise<FilterResponse> {
  return request<FilterResponse>(`/api/filters/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteFilter(id: string): Promise<void> {
  await request<void>(`/api/filters/${id}`, { method: "DELETE" });
}

// -------- Likes & Favorites --------
export async function likeFilter(id: string): Promise<void> {
  await request<void>(`/api/filters/${id}/like`, { method: "POST" });
}

export async function unlikeFilter(id: string): Promise<void> {
  await request<void>(`/api/filters/${id}/like`, { method: "DELETE" });
}

export async function favoriteFilter(id: string): Promise<void> {
  await request<void>(`/api/filters/${id}/favorite`, { method: "POST" });
}

export async function unfavoriteFilter(id: string): Promise<void> {
  await request<void>(`/api/filters/${id}/favorite`, { method: "DELETE" });
}

// -------- Quota --------
export interface QuotaResponse {
  plan: "free" | "pro";
  gemini_used: number;
  gemini_limit: number;
  hybrid_used: number;
  hybrid_limit: number;
  total_used: number;
  total_limit: number;
  can_use_custom_prompt: boolean;
}

export async function getQuota(): Promise<QuotaResponse> {
  return request<QuotaResponse>("/api/quota");
}

// -------- Stripe --------
export async function createCheckoutSession(): Promise<{ url: string }> {
  return request<{ url: string }>("/api/stripe/checkout", { method: "POST" });
}

export async function createPortalSession(): Promise<{ url: string }> {
  return request<{ url: string }>("/api/stripe/portal", { method: "POST" });
}

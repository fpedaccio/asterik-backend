-- FilterApps — initial schema
-- Tables, RLS policies, storage buckets, and profile sync trigger.

-- =========================================================================
-- Extensions
-- =========================================================================
create extension if not exists "pgcrypto";

-- =========================================================================
-- Tables
-- =========================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  created_at timestamptz not null default now()
);

create table if not exists public.filters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  prompt text not null,
  description text,
  engine text not null check (engine in ('gemini', 'hybrid')),
  params jsonb,
  preview_path text,
  visibility text not null default 'private' check (visibility in ('public', 'private')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists filters_owner_idx on public.filters (owner_id);
create index if not exists filters_public_idx on public.filters (visibility) where visibility = 'public';

create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  filter_id uuid references public.filters(id) on delete set null,
  source_path text not null,
  output_path text,
  engine text not null check (engine in ('gemini', 'hybrid')),
  prompt_used text not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'error')),
  error text,
  elapsed_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists generations_user_idx on public.generations (user_id, created_at desc);

-- =========================================================================
-- updated_at trigger for filters
-- =========================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists filters_set_updated_at on public.filters;
create trigger filters_set_updated_at
before update on public.filters
for each row execute function public.set_updated_at();

-- =========================================================================
-- Auto-create profile on signup
-- =========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- =========================================================================
-- Row Level Security
-- =========================================================================
alter table public.profiles enable row level security;
alter table public.filters enable row level security;
alter table public.generations enable row level security;

-- profiles: each user sees/edits their own row; anyone can read basic fields of public filter owners
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- filters: public rows readable by all authenticated users; owner fully controls own rows
drop policy if exists "filters_select_public_or_own" on public.filters;
create policy "filters_select_public_or_own" on public.filters
  for select using (visibility = 'public' or owner_id = auth.uid());

drop policy if exists "filters_insert_own" on public.filters;
create policy "filters_insert_own" on public.filters
  for insert with check (owner_id = auth.uid());

drop policy if exists "filters_update_own" on public.filters;
create policy "filters_update_own" on public.filters
  for update using (owner_id = auth.uid());

drop policy if exists "filters_delete_own" on public.filters;
create policy "filters_delete_own" on public.filters
  for delete using (owner_id = auth.uid());

-- generations: strictly private
drop policy if exists "generations_select_own" on public.generations;
create policy "generations_select_own" on public.generations
  for select using (user_id = auth.uid());

drop policy if exists "generations_insert_own" on public.generations;
create policy "generations_insert_own" on public.generations
  for insert with check (user_id = auth.uid());

drop policy if exists "generations_update_own" on public.generations;
create policy "generations_update_own" on public.generations
  for update using (user_id = auth.uid());

-- =========================================================================
-- Storage buckets
-- Note: service role bypasses RLS; these policies govern user-side access.
-- =========================================================================
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('generations', 'generations', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('filter-previews', 'filter-previews', true)
on conflict (id) do nothing;

-- Uploads: user can read/write only their own folder (uploads/{user_id}/...)
drop policy if exists "uploads_owner_rw" on storage.objects;
create policy "uploads_owner_rw" on storage.objects
  for all using (
    bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Generations: user can read only their own folder; writes are via service role only.
drop policy if exists "generations_owner_read" on storage.objects;
create policy "generations_owner_read" on storage.objects
  for select using (
    bucket_id = 'generations' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Filter previews: public read; writes service role only.
drop policy if exists "filter_previews_public_read" on storage.objects;
create policy "filter_previews_public_read" on storage.objects
  for select using (bucket_id = 'filter-previews');

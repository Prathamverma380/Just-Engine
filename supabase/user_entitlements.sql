create extension if not exists pgcrypto;

create table if not exists public.user_entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'premium')),
  status text not null default 'active' check (status in ('active', 'trialing', 'canceled', 'expired', 'inactive')),
  current_period_end timestamptz null,
  source text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_user_entitlements_plan_status
  on public.user_entitlements (plan, status, updated_at desc);

alter table public.user_entitlements enable row level security;

drop policy if exists "Service role manages user entitlements" on public.user_entitlements;
create policy "Service role manages user entitlements"
  on public.user_entitlements
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "Users read own entitlement" on public.user_entitlements;
create policy "Users read own entitlement"
  on public.user_entitlements
  for select
  using (auth.uid() = user_id);

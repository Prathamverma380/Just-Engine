create extension if not exists pgcrypto;

create table if not exists public."User generated AI content." (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model text not null,
  prompt text not null,
  category text not null default 'all',
  user_id uuid null,
  request_payload jsonb not null,
  response_payload jsonb not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_user_generated_ai_content_user
  on public."User generated AI content." (user_id, created_at desc);

create index if not exists idx_user_generated_ai_content_provider
  on public."User generated AI content." (provider, created_at desc);

alter table public."User generated AI content." enable row level security;

drop policy if exists "Service role manages AI content table" on public."User generated AI content.";
create policy "Service role manages AI content table"
  on public."User generated AI content."
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "Users read own AI content" on public."User generated AI content.";
create policy "Users read own AI content"
  on public."User generated AI content."
  for select
  using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('User generated AI content.', 'User generated AI content.', false)
on conflict (id) do nothing;

drop policy if exists "Service role manages AI content bucket" on storage.objects;
create policy "Service role manages AI content bucket"
  on storage.objects
  for all
  using (bucket_id = 'User generated AI content.' and auth.role() = 'service_role')
  with check (bucket_id = 'User generated AI content.' and auth.role() = 'service_role');

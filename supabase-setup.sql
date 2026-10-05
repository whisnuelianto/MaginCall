-- =====================================================================
-- RiskDesk v2 — setup Supabase
-- Jalankan sekali di Supabase: SQL Editor → New query → tempel → Run.
-- Aman dijalankan ulang.
-- =====================================================================

-- 1) Data aplikasi per pengguna (pengaturan, posisi, jurnal, berita)
create table if not exists public.riskdesk_data (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.riskdesk_data enable row level security;

drop policy if exists "rd_data_select" on public.riskdesk_data;
drop policy if exists "rd_data_insert" on public.riskdesk_data;
drop policy if exists "rd_data_update" on public.riskdesk_data;
drop policy if exists "rd_data_delete" on public.riskdesk_data;
create policy "rd_data_select" on public.riskdesk_data for select using (auth.uid() = user_id);
create policy "rd_data_insert" on public.riskdesk_data for insert with check (auth.uid() = user_id);
create policy "rd_data_update" on public.riskdesk_data for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "rd_data_delete" on public.riskdesk_data for delete using (auth.uid() = user_id);

-- 2) Posisi live dari MT5 (diisi oleh EA RiskDesk Bridge)
create table if not exists public.riskdesk_mt5 (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  token      text unique not null,
  account    jsonb,
  positions  jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.riskdesk_mt5 enable row level security;

drop policy if exists "rd_mt5_select" on public.riskdesk_mt5;
drop policy if exists "rd_mt5_insert" on public.riskdesk_mt5;
drop policy if exists "rd_mt5_update" on public.riskdesk_mt5;
drop policy if exists "rd_mt5_delete" on public.riskdesk_mt5;
create policy "rd_mt5_select" on public.riskdesk_mt5 for select using (auth.uid() = user_id);
create policy "rd_mt5_insert" on public.riskdesk_mt5 for insert with check (auth.uid() = user_id);
create policy "rd_mt5_update" on public.riskdesk_mt5 for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "rd_mt5_delete" on public.riskdesk_mt5 for delete using (auth.uid() = user_id);

-- 3) Fungsi yang dipanggil EA. EA tidak login; ia hanya tahu SyncToken rahasia.
--    Fungsi ini hanya bisa memperbarui baris milik token tersebut.
create or replace function public.riskdesk_push(p_token text, p_account jsonb, p_positions jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token is null or length(p_token) < 16 then
    return false;
  end if;
  update public.riskdesk_mt5
     set account = p_account,
         positions = coalesce(p_positions, '[]'::jsonb),
         updated_at = now()
   where token = p_token;
  return found;
end;
$$;

revoke all on function public.riskdesk_push(text, jsonb, jsonb) from public;
grant execute on function public.riskdesk_push(text, jsonb, jsonb) to anon, authenticated;

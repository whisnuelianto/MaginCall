-- =====================================================================
-- RiskDesk — kode undangan untuk pendaftaran akun
-- Jalankan SETELAH supabase-setup.sql, sekali saja: SQL Editor → New query → Run.
--
-- 1) GANTI 'kodeRahasiaAnda' di baris paling bawah dengan kode pilihan Anda.
-- 2) Bagikan kode itu hanya ke orang yang Anda izinkan.
-- Pendaftaran dengan kode salah atau kosong akan DITOLAK oleh server.
-- =====================================================================

-- Skema privat: tidak bisa diakses lewat API publik
create schema if not exists private;
revoke all on schema private from anon, authenticated;

create table if not exists private.riskdesk_invite (
  id   int primary key default 1 check (id = 1),
  code text not null
);
revoke all on private.riskdesk_invite from anon, authenticated;

-- Fungsi pengecek: berjalan setiap kali ada akun baru dibuat
create or replace function private.riskdesk_check_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  select code into v_code from private.riskdesk_invite where id = 1;
  -- Jika kode belum diatur / dikosongkan, pendaftaran terbuka untuk semua
  if v_code is null or v_code = '' then
    return new;
  end if;
  if coalesce(new.raw_user_meta_data ->> 'invite_code', '') <> v_code then
    raise exception 'RISKDESK_INVITE_INVALID';
  end if;
  -- Jangan simpan kode di data akun
  new.raw_user_meta_data := new.raw_user_meta_data - 'invite_code';
  return new;
end;
$$;

grant usage on schema private to supabase_auth_admin;
grant execute on function private.riskdesk_check_invite() to supabase_auth_admin;
grant select on private.riskdesk_invite to supabase_auth_admin;

drop trigger if exists riskdesk_invite_check on auth.users;
create trigger riskdesk_invite_check
  before insert on auth.users
  for each row execute function private.riskdesk_check_invite();

-- >>> GANTI KODE DI SINI <<<
insert into private.riskdesk_invite (id, code) values (1, 'suksesterus')
on conflict (id) do update set code = excluded.code;

-- Cara mengganti kode di kemudian hari (jalankan baris ini saja):
--   update private.riskdesk_invite set code = 'kodeBaru' where id = 1;
-- Cara membuka pendaftaran untuk semua orang:
--   update private.riskdesk_invite set code = '' where id = 1;

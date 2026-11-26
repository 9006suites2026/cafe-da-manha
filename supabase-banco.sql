-- =====================================================================
--  Café da Manhã – 9006 Suites & Reserva Madero
--  Script do banco para o Supabase.
--  Como usar: no painel do Supabase abra "SQL Editor" → "New query",
--  cole este arquivo inteiro e clique em "Run". Pode rodar mais de uma vez.
-- =====================================================================

-- ---------- Reservas ----------
create table if not exists public.reservas (
  id          text primary key default gen_random_uuid()::text,
  emp         text not null check (emp in ('9006', 'madero')),
  apto        text not null,
  hospede     text not null default '',
  adultos     integer not null default 0 check (adultos >= 0),
  criancas    integer not null default 0 check (criancas >= 0),
  checkin     date not null,
  checkout    date not null,
  cafe        boolean not null default true,
  obs         text not null default '',
  created_at  timestamptz not null default now(),
  constraint checkout_depois_checkin check (checkout > checkin)
);
create index if not exists reservas_checkout_idx on public.reservas (checkout);

-- ---------- Extras do dia (day use, café avulso, convidados) ----------
create table if not exists public.extras (
  dia       date not null,
  emp       text not null check (emp in ('9006', 'madero')),
  adultos   integer not null default 0 check (adultos >= 0),
  criancas  integer not null default 0 check (criancas >= 0),
  primary key (dia, emp)
);

-- ---------- Configuração do pedido à padaria (uma linha só) ----------
create table if not exists public.config (
  id      integer primary key default 1 check (id = 1),
  itens   jsonb not null,
  margem  numeric not null default 10
);
insert into public.config (id, itens, margem) values (1, '[
  {"nome":"Pão francês","un":"un","adulto":2,"crianca":1},
  {"nome":"Pão de queijo","un":"un","adulto":3,"crianca":2},
  {"nome":"Croissant / folhado","un":"un","adulto":1,"crianca":0.5},
  {"nome":"Bolo (fatias)","un":"fatia","adulto":1,"crianca":1},
  {"nome":"Presunto","un":"g","adulto":40,"crianca":20},
  {"nome":"Queijo mussarela","un":"g","adulto":40,"crianca":20},
  {"nome":"Leite","un":"ml","adulto":200,"crianca":250}
]'::jsonb, 10)
on conflict (id) do nothing;

-- ---------- Segurança (RLS) ----------
-- Só usuários logados (recepção / restaurante) leem e gravam.
-- Visitantes sem login não veem nada, mesmo tendo a chave pública da página.
alter table public.reservas enable row level security;
alter table public.extras   enable row level security;
alter table public.config   enable row level security;

drop policy if exists "equipe acessa reservas" on public.reservas;
drop policy if exists "equipe acessa extras"   on public.extras;
drop policy if exists "equipe acessa config"   on public.config;
create policy "equipe acessa reservas" on public.reservas for all to authenticated using (true) with check (true);
create policy "equipe acessa extras"   on public.extras   for all to authenticated using (true) with check (true);
create policy "equipe acessa config"   on public.config   for all to authenticated using (true) with check (true);

revoke all on public.reservas, public.extras, public.config from anon;
grant select, insert, update, delete on public.reservas, public.extras, public.config to authenticated;

-- ---------- Tempo real (recepção e restaurante veem as mudanças na hora) ----------
do $$
begin
  begin alter publication supabase_realtime add table public.reservas; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.extras;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.config;   exception when duplicate_object then null; end;
end $$;

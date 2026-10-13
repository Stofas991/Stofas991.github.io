-- Generátor faktur: schéma pro Supabase.
-- Spusť celý soubor v SQL editoru projektu (Dashboard -> SQL Editor).
-- Po spuštění vypni veřejné registrace: Authentication -> Sign In / Providers -> "Allow new users to sign up" = off,
-- a svůj e-mail přidej ručně: Authentication -> Users -> Add user.

create table public.supplier_profile (
  id int primary key default 1 check (id = 1),
  name text not null default '',
  address text not null default '',
  city text not null default '',
  ico text not null default '',
  dic text not null default '',
  account text not null default '',
  email text not null default '',
  website text not null default '',
  payment text not null default 'Bankovním převodem',
  due_days int not null default 14,
  vat_payer boolean not null default false
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null default '',
  city text not null default '',
  ico text not null default '',
  dic text not null default '',
  email text not null default '',
  created_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  customer_id uuid references public.customers(id) on delete set null,
  issued date,
  due date,
  payment text not null default '',
  symbol text not null default '',
  note text not null default '',
  vat_payer boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid')),
  paid_at timestamptz,
  -- Údaje stran platné v den vystavení; pozdější úprava adresáře starou fakturu nezmění.
  supplier_snapshot jsonb not null default '{}'::jsonb,
  customer_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  position int not null default 0,
  description text not null default '',
  details text not null default '',
  quantity numeric not null default 1,
  price numeric not null default 0
);
create index invoice_items_invoice_id_idx on public.invoice_items(invoice_id, position);

create table public.invoice_counters (
  year int primary key,
  last_number int not null
);

-- Další číslo faktury ve tvaru RRRRNNN (2026001). Upsert zamkne řádek čítače,
-- takže souběžná volání nikdy nevrátí stejné číslo.
create or replace function public.next_invoice_number() returns text
language plpgsql as $$
declare
  y int := extract(year from (now() at time zone 'Europe/Prague'))::int;
  n int;
begin
  insert into public.invoice_counters (year, last_number) values (y, 1)
  on conflict (year) do update set last_number = public.invoice_counters.last_number + 1
  returning last_number into n;
  return y::text || lpad(n::text, 3, '0');
end $$;

-- Nová koncepce faktury: číslo, dnešní datum, splatnost a strany z nastavení dodavatele.
create or replace function public.create_invoice() returns uuid
language plpgsql as $$
declare
  p public.supplier_profile;
  v_number text := public.next_invoice_number();
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_id uuid;
begin
  select * into p from public.supplier_profile where id = 1;
  insert into public.invoices (number, issued, due, payment, symbol, vat_payer, supplier_snapshot)
  values (
    v_number, v_today, v_today + coalesce(p.due_days, 14),
    coalesce(p.payment, 'Bankovním převodem'), v_number, coalesce(p.vat_payer, false),
    jsonb_build_object(
      'name', coalesce(p.name, ''), 'address', coalesce(p.address, ''), 'city', coalesce(p.city, ''),
      'id', coalesce(p.ico, ''), 'vat', coalesce(p.dic, ''), 'account', coalesce(p.account, ''),
      'email', coalesce(p.email, ''), 'website', coalesce(p.website, '')
    )
  )
  returning id into v_id;
  return v_id;
end $$;

-- Uložení faktury i položek v jedné transakci (položky se nahradí celé).
create or replace function public.save_invoice(p jsonb) returns uuid
language plpgsql as $$
declare
  v_id uuid := (p->>'id')::uuid;
begin
  update public.invoices set
    number = p->>'number',
    customer_id = nullif(p->>'customer_id', '')::uuid,
    issued = nullif(p->>'issued', '')::date,
    due = nullif(p->>'due', '')::date,
    payment = coalesce(p->>'payment', ''),
    symbol = coalesce(p->>'symbol', ''),
    note = coalesce(p->>'note', ''),
    vat_payer = coalesce((p->>'vat_payer')::boolean, false),
    status = p->>'status',
    paid_at = case when p->>'status' = 'paid' then coalesce(paid_at, now()) else null end,
    supplier_snapshot = coalesce(p->'supplier_snapshot', '{}'::jsonb),
    customer_snapshot = coalesce(p->'customer_snapshot', '{}'::jsonb)
  where id = v_id;
  if not found then
    raise exception 'Faktura % neexistuje', v_id;
  end if;

  delete from public.invoice_items where invoice_id = v_id;
  insert into public.invoice_items (invoice_id, position, description, details, quantity, price)
  select v_id, (t.ord - 1)::int, coalesce(t.item->>'description', ''), coalesce(t.item->>'details', ''),
         coalesce((t.item->>'quantity')::numeric, 0), coalesce((t.item->>'price')::numeric, 0)
  from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) with ordinality as t(item, ord);
  return v_id;
end $$;

-- Přístup má jen přihlášený uživatel; anonymní klíč z webu sám o sobě nevidí nic.
alter table public.supplier_profile enable row level security;
alter table public.customers enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.invoice_counters enable row level security;

create policy owner_all on public.supplier_profile for all to authenticated using (true) with check (true);
create policy owner_all on public.customers for all to authenticated using (true) with check (true);
create policy owner_all on public.invoices for all to authenticated using (true) with check (true);
create policy owner_all on public.invoice_items for all to authenticated using (true) with check (true);
create policy owner_all on public.invoice_counters for all to authenticated using (true) with check (true);

revoke all on public.supplier_profile, public.customers, public.invoices, public.invoice_items, public.invoice_counters from anon;
revoke execute on function public.next_invoice_number(), public.create_invoice(), public.save_invoice(jsonb) from public, anon;
grant execute on function public.next_invoice_number(), public.create_invoice(), public.save_invoice(jsonb) to authenticated;

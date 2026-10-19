

alter table public.equipment
  add column if not exists source_device_id text,
  add column if not exists status text not null default 'active';

create unique index if not exists equipment_source_device_id_uidx
  on public.equipment (source_device_id)
  where source_device_id is not null;

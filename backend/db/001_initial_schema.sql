


create table if not exists public.equipment (
  equipment_id text primary key,
  name text not null,
  source_device_id text unique,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.sensor_readings (
  id bigint generated always as identity primary key,
  equipment_id text not null references public.equipment(equipment_id),
  recorded_at timestamptz not null,
  temperature_c double precision,
  rpm double precision,
  fuel_efficiency double precision,
  vibration_x double precision,
  vibration_y double precision,
  vibration_z double precision,
  torque_nm double precision,
  power_output_kw double precision,
  fault_condition integer,
  operational_mode text,
  raw_reading jsonb not null default '{}'::jsonb
);

create index if not exists sensor_readings_equipment_time_idx
  on public.sensor_readings (equipment_id, recorded_at desc);

create table if not exists public.predictions (
  id bigint generated always as identity primary key,
  equipment_id text not null references public.equipment(equipment_id),
  predicted_at timestamptz not null default now(),
  severity text not null,
  anomaly_score double precision,
  message text,
  feature_snapshot jsonb not null default '{}'::jsonb,
  top_anomalous_features jsonb not null default '[]'::jsonb,
  model_metadata jsonb not null default '{}'::jsonb
);

create index if not exists predictions_equipment_time_idx
  on public.predictions (equipment_id, predicted_at desc);

create table if not exists public.alerts (
  id bigint generated always as identity primary key,
  equipment_id text not null references public.equipment(equipment_id),
  severity text not null,
  anomaly_score double precision,
  message text,
  feature_snapshot jsonb not null default '{}'::jsonb,
  top_anomalous_features jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  acknowledged boolean not null default false,
  acknowledged_at timestamptz
);

create index if not exists alerts_active_time_idx
  on public.alerts (created_at desc) where acknowledged = false;
create index if not exists alerts_equipment_time_idx
  on public.alerts (equipment_id, created_at desc);



alter table public.equipment enable row level security;
alter table public.sensor_readings enable row level security;
alter table public.predictions enable row level security;
alter table public.alerts enable row level security;

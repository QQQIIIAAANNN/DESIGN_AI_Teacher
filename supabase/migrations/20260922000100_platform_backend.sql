-- DESIGN_AI_Teacher: private Supabase schema for exam questions, curated knowledge,
-- drawing reviews, SVG findings, and individually generated suggestion images.
-- This migration intentionally creates private Storage buckets and restrictive RLS policies.

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated;

create or replace function app_private.is_active_member()
returns boolean
language sql
stable
set search_path = ''
as $function$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'membership_status', '') = 'active'
$function$;

create or replace function app_private.has_app_role(required_role text)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select app_private.is_active_member()
    and coalesce(auth.jwt() -> 'app_metadata' -> 'roles', '[]'::jsonb) ? required_role
$function$;

revoke all on function app_private.is_active_member() from public, anon;
revoke all on function app_private.has_app_role(text) from public, anon;
grant execute on function app_private.is_active_member() to authenticated;
grant execute on function app_private.has_app_role(text) to authenticated;

create table public.question_papers (
  id uuid primary key default gen_random_uuid(),
  exam_year integer not null check (exam_year between 1900 and 2200),
  exam_type text not null check (exam_type in ('architectural_design', 'site_planning', 'civil_service_grade_3', 'other')),
  title text not null check (char_length(trim(title)) between 1 and 240),
  original_filename text not null check (char_length(original_filename) between 1 and 500),
  storage_path text not null unique,
  mime_type text not null default 'application/pdf' check (mime_type = 'application/pdf'),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index question_papers_catalog_idx
  on public.question_papers (exam_year desc, exam_type, status, title);

create table public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 500),
  instructor text,
  source_kind text not null default 'other'
    check (source_kind in ('lecture', 'lecture_notes', 'teacher_markup', 'precedent', 'photo', 'other')),
  original_filename text,
  storage_path text,
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.knowledge_units (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.knowledge_sources(id) on delete restrict,
  building_type text not null,
  topic_key text not null,
  knowledge_type text not null
    check (knowledge_type in ('hard_rule', 'soft_rule', 'heuristic', 'anti_pattern', 'repair_pattern', 'precedent', 'preference')),
  statement text not null check (char_length(trim(statement)) between 1 and 6000),
  rationale text,
  repair_strategy text,
  page_start integer check (page_start is null or page_start > 0),
  page_end integer check (page_end is null or page_end >= page_start),
  provenance jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index knowledge_units_lookup_idx
  on public.knowledge_units (building_type, topic_key, knowledge_type, status);

create table public.image_regions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.knowledge_sources(id) on delete restrict,
  page_number integer not null check (page_number > 0),
  region_kind text not null
    check (region_kind in ('good_pattern', 'bad_pattern', 'teacher_markup', 'diagram', 'precedent', 'other')),
  bbox jsonb not null check (jsonb_typeof(bbox) = 'object'),
  storage_path text,
  caption text,
  instructor_note text,
  provenance jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index image_regions_source_page_idx
  on public.image_regions (source_id, page_number, status);

create table public.knowledge_image_links (
  knowledge_unit_id uuid not null references public.knowledge_units(id) on delete cascade,
  image_region_id uuid not null references public.image_regions(id) on delete cascade,
  link_kind text not null
    check (link_kind in ('illustrates', 'good_pattern', 'bad_pattern', 'repair_example', 'precedent')),
  notes text,
  created_at timestamptz not null default now(),
  primary key (knowledge_unit_id, image_region_id, link_kind)
);

create table public.review_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  exam_question_id uuid references public.question_papers(id) on delete set null,
  drawing_name text not null,
  drawing_storage_path text,
  model_slug text,
  status text not null default 'completed' check (status in ('pending', 'completed', 'failed')),
  overall_score integer check (overall_score is null or overall_score between 0 and 100),
  review_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index review_sessions_owner_created_idx
  on public.review_sessions (owner_id, created_at desc);

create table public.review_findings (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.review_sessions(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  finding_key text not null,
  kind text not null check (kind in ('issue', 'clarity_request')),
  category text not null,
  severity text not null check (severity in ('high', 'medium', 'low', 'info')),
  score_impact numeric,
  confidence numeric not null check (confidence between 0 and 1),
  visibility_status text not null
    check (visibility_status in ('clear', 'partially_blurry', 'illegible')),
  title text not null,
  description text not null,
  suggestion text not null,
  bbox jsonb not null check (jsonb_typeof(bbox) = 'object'),
  redline jsonb,
  crop_request jsonb,
  knowledge_unit_id uuid references public.knowledge_units(id) on delete set null,
  image_region_id uuid references public.image_regions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (review_id, finding_key)
);

create index review_findings_review_idx
  on public.review_findings (review_id, owner_id);

create table public.suggestion_images (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.review_sessions(id) on delete cascade,
  finding_id uuid not null references public.review_findings(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  storage_path text not null unique,
  model_slug text not null,
  prompt_version text not null default 'issue-image-v1',
  created_at timestamptz not null default now()
);

create index suggestion_images_finding_idx
  on public.suggestion_images (finding_id, created_at desc);

create table app_private.ai_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_day date not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, usage_day)
);

revoke all on all tables in schema app_private from public, anon, authenticated;

create or replace function public.consume_ai_request()
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_count integer;
begin
  if auth.uid() is null or not app_private.is_active_member() then
    return false;
  end if;

  insert into app_private.ai_daily_usage as daily_usage (user_id, usage_day, request_count)
  values (auth.uid(), (pg_catalog.now() at time zone 'UTC')::date, 1)
  on conflict (user_id, usage_day)
  do update set request_count = daily_usage.request_count + 1
  returning request_count into current_count;

  -- Default safety limit: 30 AI calls per active account per UTC day.
  return current_count <= 30;
end
$function$;

revoke all on function public.consume_ai_request() from public, anon, authenticated;
grant execute on function public.consume_ai_request() to authenticated;

alter table public.question_papers enable row level security;
alter table public.knowledge_sources enable row level security;
alter table public.knowledge_units enable row level security;
alter table public.image_regions enable row level security;
alter table public.knowledge_image_links enable row level security;
alter table public.review_sessions enable row level security;
alter table public.review_findings enable row level security;
alter table public.suggestion_images enable row level security;

revoke all on public.question_papers, public.knowledge_sources, public.knowledge_units,
  public.image_regions, public.knowledge_image_links, public.review_sessions,
  public.review_findings, public.suggestion_images from anon;

grant select, insert, update, delete on public.question_papers to authenticated;
grant select, insert, update, delete on public.knowledge_sources to authenticated;
grant select, insert, update, delete on public.knowledge_units to authenticated;
grant select, insert, update, delete on public.image_regions to authenticated;
grant select, insert, update, delete on public.knowledge_image_links to authenticated;
grant select, insert, update, delete on public.review_sessions to authenticated;
grant select, insert, update, delete on public.review_findings to authenticated;
grant select, insert, update, delete on public.suggestion_images to authenticated;

create policy "Active members read published question papers"
  on public.question_papers for select to authenticated
  using (
    app_private.is_active_member()
    and (status = 'published' or app_private.has_app_role('curator') or app_private.has_app_role('admin'))
  );

create policy "Curators create question papers"
  on public.question_papers for insert to authenticated
  with check (
    app_private.is_active_member()
    and uploaded_by = auth.uid()
    and (app_private.has_app_role('curator') or app_private.has_app_role('admin'))
  );

create policy "Curators update question papers"
  on public.question_papers for update to authenticated
  using (app_private.has_app_role('curator') or app_private.has_app_role('admin'))
  with check (app_private.has_app_role('curator') or app_private.has_app_role('admin'));

create policy "Admins delete question papers"
  on public.question_papers for delete to authenticated
  using (app_private.has_app_role('admin'));

create policy "Members read published knowledge sources"
  on public.knowledge_sources for select to authenticated
  using (
    app_private.is_active_member()
    and (status = 'published' or app_private.has_app_role('curator') or app_private.has_app_role('admin'))
  );

create policy "Curators manage knowledge sources"
  on public.knowledge_sources for all to authenticated
  using (app_private.has_app_role('curator') or app_private.has_app_role('admin'))
  with check (app_private.has_app_role('curator') or app_private.has_app_role('admin'));

create policy "Members read published knowledge units"
  on public.knowledge_units for select to authenticated
  using (
    app_private.is_active_member()
    and status = 'published'
    and exists (
      select 1 from public.knowledge_sources s
      where s.id = source_id and s.status = 'published'
    )
  );

create policy "Curators manage knowledge units"
  on public.knowledge_units for all to authenticated
  using (app_private.has_app_role('curator') or app_private.has_app_role('admin'))
  with check (app_private.has_app_role('curator') or app_private.has_app_role('admin'));

create policy "Members read published image regions"
  on public.image_regions for select to authenticated
  using (
    app_private.is_active_member()
    and status = 'published'
    and exists (
      select 1 from public.knowledge_sources s
      where s.id = source_id and s.status = 'published'
    )
  );

create policy "Curators manage image regions"
  on public.image_regions for all to authenticated
  using (app_private.has_app_role('curator') or app_private.has_app_role('admin'))
  with check (app_private.has_app_role('curator') or app_private.has_app_role('admin'));

create policy "Members read knowledge image links"
  on public.knowledge_image_links for select to authenticated
  using (
    app_private.is_active_member()
    and exists (
      select 1 from public.knowledge_units ku
      join public.image_regions ir on ir.id = image_region_id
      where ku.id = knowledge_unit_id
        and ku.status = 'published'
        and ir.status = 'published'
    )
  );

create policy "Curators manage knowledge image links"
  on public.knowledge_image_links for all to authenticated
  using (app_private.has_app_role('curator') or app_private.has_app_role('admin'))
  with check (app_private.has_app_role('curator') or app_private.has_app_role('admin'));

create policy "Users manage their review sessions"
  on public.review_sessions for all to authenticated
  using (app_private.is_active_member() and owner_id = auth.uid())
  with check (app_private.is_active_member() and owner_id = auth.uid());

create policy "Users manage their review findings"
  on public.review_findings for all to authenticated
  using (
    app_private.is_active_member()
    and owner_id = auth.uid()
    and exists (
      select 1 from public.review_sessions r
      where r.id = review_id and r.owner_id = auth.uid()
    )
  )
  with check (
    app_private.is_active_member()
    and owner_id = auth.uid()
    and exists (
      select 1 from public.review_sessions r
      where r.id = review_id and r.owner_id = auth.uid()
    )
  );

create policy "Users manage their suggestion images"
  on public.suggestion_images for all to authenticated
  using (
    app_private.is_active_member()
    and owner_id = auth.uid()
    and exists (
      select 1 from public.review_sessions r
      where r.id = review_id and r.owner_id = auth.uid()
    )
    and exists (
      select 1 from public.review_findings f
      where f.id = finding_id and f.review_id = review_id and f.owner_id = auth.uid()
    )
  )
  with check (
    app_private.is_active_member()
    and owner_id = auth.uid()
    and exists (
      select 1 from public.review_sessions r
      where r.id = review_id and r.owner_id = auth.uid()
    )
    and exists (
      select 1 from public.review_findings f
      where f.id = finding_id and f.review_id = review_id and f.owner_id = auth.uid()
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('exam-papers', 'exam-papers', false, 26214400, array['application/pdf']),
  ('source-documents', 'source-documents', false, 52428800, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']),
  ('knowledge-assets', 'knowledge-assets', false, 20971520, array['image/png', 'image/jpeg', 'image/webp']),
  ('student-drawings', 'student-drawings', false, 26214400, array['image/png', 'image/jpeg', 'image/webp']),
  ('suggestion-images', 'suggestion-images', false, 20971520, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set name = excluded.name,
      public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "Members read published exam PDFs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'exam-papers'
    and app_private.is_active_member()
    and exists (
      select 1 from public.question_papers q
      where q.storage_path = storage.objects.name
        and (q.status = 'published' or app_private.has_app_role('curator') or app_private.has_app_role('admin'))
    )
  );

create policy "Curators upload exam PDFs to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'exam-papers'
    and app_private.is_active_member()
    and (app_private.has_app_role('curator') or app_private.has_app_role('admin'))
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Admins remove exam PDFs"
  on storage.objects for delete to authenticated
  using (bucket_id = 'exam-papers' and app_private.has_app_role('admin'));

create policy "Curators read source documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'source-documents'
    and (app_private.has_app_role('curator') or app_private.has_app_role('admin'))
  );

create policy "Curators upload source documents to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'source-documents'
    and (app_private.has_app_role('curator') or app_private.has_app_role('admin'))
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Members read linked knowledge images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'knowledge-assets'
    and app_private.is_active_member()
    and exists (
      select 1
      from public.image_regions ir
      join public.knowledge_image_links l on l.image_region_id = ir.id
      join public.knowledge_units ku on ku.id = l.knowledge_unit_id
      where ir.storage_path = storage.objects.name
        and ir.status = 'published'
        and ku.status = 'published'
    )
  );

create policy "Curators upload knowledge images to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'knowledge-assets'
    and (app_private.has_app_role('curator') or app_private.has_app_role('admin'))
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users read their own drawings"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'student-drawings'
    and app_private.is_active_member()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users upload their own drawings"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'student-drawings'
    and app_private.is_active_member()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users delete their own drawings"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'student-drawings'
    and app_private.is_active_member()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users read their own suggestion images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'suggestion-images'
    and app_private.is_active_member()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users upload their own suggestion images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'suggestion-images'
    and app_private.is_active_member()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users delete their own suggestion images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'suggestion-images'
    and app_private.is_active_member()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

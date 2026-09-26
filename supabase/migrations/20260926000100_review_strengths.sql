-- Preserve evidence-backed strengths alongside issues and clarification requests.
alter table public.review_findings drop constraint if exists review_findings_kind_check;
alter table public.review_findings add constraint review_findings_kind_check
  check (kind in ('issue', 'clarity_request', 'strength'));

-- ============================================================
-- 0008_storage_bucket.sql
-- JV Skill Intelligence — Storage bucket for original upload files
-- Source: Implementation Architecture v3.0 §1, §3.1 step 1
-- ============================================================

insert into storage.buckets (id, name, public)
values ('raw-uploads', 'raw-uploads', false)
on conflict (id) do nothing;

-- Only ADMIN/HRBP (via app_user_profile) may read/write the raw-uploads
-- bucket — mirrors RoleCapabilities.canUploadImport in lib/auth/rbac.ts.
create policy p_raw_uploads_admin_hrbp_all on storage.objects
  for all using (
    bucket_id = 'raw-uploads'
    and exists (
      select 1 from app_user_profile p
      where p.user_id = auth.uid() and p.role in ('ADMIN', 'HRBP')
    )
  );

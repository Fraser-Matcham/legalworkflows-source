-- Migration date: 2026-09-17
--
-- A permissive row-level-security policy for service_role on every table that
-- has RLS enabled, so the backend's queries pass on a PostgreSQL where
-- service_role cannot carry BYPASSRLS.
--
-- On Supabase the backend's queries pass the deny-all RLS on these tables
-- because service_role has the BYPASSRLS attribute. PostgreSQL lets only a
-- genuine superuser confer that attribute, and the master user of the RDS
-- instance the platform is moving to (stage 5, infra/modules/database) is
-- rds_superuser, which is not one. Without this, every backend query against
-- the restored database returns zero rows, permission granted, no error.
--
-- What it does not change: anon and authenticated. A policy is scoped to the
-- roles it names, so a table with only this policy is exactly as deny-all for
-- the browser roles as a table with none; the stack test's leak sweep and
-- scripts/check-schema-privileges.mjs are unaffected. On Supabase, where
-- service_role already bypasses RLS, the policy is redundant and inert.
--
-- The tables are the thirty schema.sql enables RLS on, in its order. A table
-- that gains RLS later needs its own policy here, which is the one thing
-- BYPASSRLS did not require; the fresh-versus-upgraded drift check catches a
-- policy added to one file and not the other.
--
-- drop-before-create, so this is safe to re-run.

drop policy if exists service_role_all on public.auth_handoff_tickets;
create policy service_role_all on public.auth_handoff_tickets
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.organizations;
create policy service_role_all on public.organizations
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.org_members;
create policy service_role_all on public.org_members
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.org_invitations;
create policy service_role_all on public.org_invitations
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.user_api_keys;
create policy service_role_all on public.user_api_keys
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.user_router_models;
create policy service_role_all on public.user_router_models
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.user_mcp_connectors;
create policy service_role_all on public.user_mcp_connectors
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.user_mcp_oauth_tokens;
create policy service_role_all on public.user_mcp_oauth_tokens
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.user_mcp_oauth_states;
create policy service_role_all on public.user_mcp_oauth_states
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.user_mcp_connector_tools;
create policy service_role_all on public.user_mcp_connector_tools
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.user_mcp_tool_audit_logs;
create policy service_role_all on public.user_mcp_tool_audit_logs
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.project_access_grants;
create policy service_role_all on public.project_access_grants
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.project_org_access_overrides;
create policy service_role_all on public.project_org_access_overrides
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.upload_sessions;
create policy service_role_all on public.upload_sessions
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.upload_session_files;
create policy service_role_all on public.upload_session_files
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.upload_processing_jobs;
create policy service_role_all on public.upload_processing_jobs
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.workflow_org_access_overrides;
create policy service_role_all on public.workflow_org_access_overrides
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.workflow_open_source_submissions;
create policy service_role_all on public.workflow_open_source_submissions
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.chat_access_grants;
create policy service_role_all on public.chat_access_grants
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.word_documents;
create policy service_role_all on public.word_documents
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.word_chats;
create policy service_role_all on public.word_chats
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.word_chat_messages;
create policy service_role_all on public.word_chat_messages
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.word_document_edits;
create policy service_role_all on public.word_document_edits
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.tabular_review_access_grants;
create policy service_role_all on public.tabular_review_access_grants
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.tabular_review_rows;
create policy service_role_all on public.tabular_review_rows
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.tabular_review_row_sources;
create policy service_role_all on public.tabular_review_row_sources
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.courtlistener_citation_index;
create policy service_role_all on public.courtlistener_citation_index
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.courtlistener_opinion_cluster_index;
create policy service_role_all on public.courtlistener_opinion_cluster_index
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.audit_events;
create policy service_role_all on public.audit_events
  for all to service_role using (true) with check (true);
drop policy if exists service_role_all on public.db_jobs;
create policy service_role_all on public.db_jobs
  for all to service_role using (true) with check (true);

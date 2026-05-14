-- Rename the default workspace name from the internal sentinel 'default'
-- to the user-visible 'Workspace'. New workspaces are created with 'Workspace'
-- by the application layer; this migration fixes existing rows.
UPDATE workspaces SET name = 'Workspace' WHERE name = 'default';

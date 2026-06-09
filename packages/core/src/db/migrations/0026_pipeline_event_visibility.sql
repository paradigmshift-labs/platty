ALTER TABLE pipeline_events ADD COLUMN visibility TEXT NOT NULL DEFAULT 'user';
--> statement-breakpoint
ALTER TABLE pipeline_events ADD COLUMN message_key TEXT;
--> statement-breakpoint
ALTER TABLE pipeline_events ADD COLUMN message_params TEXT;
--> statement-breakpoint
CREATE INDEX idx_pipeline_events_run_visibility ON pipeline_events (run_id, visibility, id);

DROP INDEX IF EXISTS `idx_generation_tasks_run_target`;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_generation_tasks_run_repo_target` ON `generation_tasks` (`run_id`,`repository_id`,`target_key`);

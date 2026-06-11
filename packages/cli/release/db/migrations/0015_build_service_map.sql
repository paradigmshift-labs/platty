CREATE TABLE `service_map_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`run_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`source_label` text,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`target_label` text,
	`kind` text NOT NULL,
	`canonical_target` text NOT NULL,
	`confidence` text NOT NULL,
	`source` text NOT NULL,
	`evidence` text NOT NULL,
	`unresolved_reason` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_service_map_edges_repo` ON `service_map_edges` (`repo_id`);
--> statement-breakpoint
CREATE INDEX `idx_service_map_edges_repo_kind` ON `service_map_edges` (`repo_id`,`kind`);
--> statement-breakpoint
CREATE INDEX `idx_service_map_edges_source_node` ON `service_map_edges` (`source_type`,`source_id`);
--> statement-breakpoint
CREATE INDEX `idx_service_map_edges_target_node` ON `service_map_edges` (`target_type`,`target_id`);
--> statement-breakpoint
CREATE INDEX `idx_service_map_edges_canonical` ON `service_map_edges` (`repo_id`,`canonical_target`);
--> statement-breakpoint
CREATE INDEX `idx_service_map_edges_logical_uniq` ON `service_map_edges` (`repo_id`,`source_type`,`source_id`,`target_type`,`target_id`,`kind`,`canonical_target`);

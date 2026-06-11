CREATE TABLE `service_map_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`repo_id` text,
	`type` text NOT NULL,
	`node_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_id` text NOT NULL,
	`canonical_key` text NOT NULL,
	`label` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_service_map_nodes_project` ON `service_map_nodes` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_service_map_nodes_repo` ON `service_map_nodes` (`repo_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_service_map_nodes_project_node` ON `service_map_nodes` (`project_id`,`type`,`node_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_service_map_nodes_project_source`
ON `service_map_nodes` (`project_id`,`type`,`source_kind`,`source_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_service_map_nodes_project_canonical`
ON `service_map_nodes` (`project_id`,`canonical_key`);
--> statement-breakpoint
ALTER TABLE `service_map_edges` ADD `project_id` text REFERENCES `projects`(`id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `service_map_edges` ADD `source_repo_id` text REFERENCES `repositories`(`id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `service_map_edges` ADD `target_repo_id` text REFERENCES `repositories`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `service_map_edges` ADD `source_node_id` text REFERENCES `service_map_nodes`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `service_map_edges` ADD `target_node_id` text REFERENCES `service_map_nodes`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `idx_service_map_edges_project` ON `service_map_edges` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_service_map_edges_source_repo` ON `service_map_edges` (`source_repo_id`);
--> statement-breakpoint
CREATE INDEX `idx_service_map_edges_target_repo` ON `service_map_edges` (`target_repo_id`);
--> statement-breakpoint
CREATE INDEX `idx_service_map_edges_source_service_node` ON `service_map_edges` (`source_node_id`);
--> statement-breakpoint
CREATE INDEX `idx_service_map_edges_target_service_node` ON `service_map_edges` (`target_node_id`);

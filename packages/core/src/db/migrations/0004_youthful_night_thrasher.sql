CREATE TABLE `code_bundles` (
	`entry_point_id` text NOT NULL,
	`node_id` text NOT NULL,
	`depth` integer NOT NULL,
	`edge_path` text,
	PRIMARY KEY(`entry_point_id`, `node_id`),
	FOREIGN KEY (`entry_point_id`) REFERENCES `entry_points`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_id`) REFERENCES `code_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_bundles_node` ON `code_bundles` (`node_id`);--> statement-breakpoint
CREATE TABLE `entry_points` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`framework` text NOT NULL,
	`kind` text NOT NULL,
	`http_method` text,
	`path` text,
	`parent_path` text,
	`full_path` text,
	`handler_node_id` text NOT NULL,
	`metadata` text,
	`detection_source` text NOT NULL,
	`confidence` text NOT NULL,
	`detection_evidence` text,
	`truncated_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`handler_node_id`) REFERENCES `code_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_entry_points_uniq` ON `entry_points` (`repo_id`,`framework`,`kind`,`http_method`,`full_path`,`handler_node_id`);--> statement-breakpoint
CREATE INDEX `idx_entry_points_repo` ON `entry_points` (`repo_id`);--> statement-breakpoint
CREATE INDEX `idx_entry_points_handler` ON `entry_points` (`handler_node_id`);--> statement-breakpoint
CREATE TABLE `framework_detections` (
	`repo_id` text NOT NULL,
	`framework` text NOT NULL,
	`detected_via` text NOT NULL,
	`evidence` text,
	`active` integer NOT NULL,
	`detected_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`repo_id`, `framework`),
	FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);

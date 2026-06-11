CREATE TABLE `code_edges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo_id` text NOT NULL,
	`source_id` text NOT NULL,
	`target_id` text,
	`relation` text NOT NULL,
	`target_specifier` text,
	`target_symbol` text,
	`first_arg` text,
	`literal_args` text,
	`resolve_status` text DEFAULT 'pending' NOT NULL,
	`confidence` text,
	`source` text DEFAULT 'static' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_code_edges_uniq` ON `code_edges` (`source_id`,`target_id`,`relation`,`target_specifier`,`target_symbol`,`first_arg`,`literal_args`);--> statement-breakpoint
CREATE INDEX `idx_code_edges_repo` ON `code_edges` (`repo_id`);--> statement-breakpoint
CREATE INDEX `idx_code_edges_source` ON `code_edges` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_code_edges_target` ON `code_edges` (`target_id`);--> statement-breakpoint
CREATE TABLE `code_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`type` text NOT NULL,
	`file_path` text NOT NULL,
	`name` text NOT NULL,
	`line_start` integer,
	`line_end` integer,
	`signature` text,
	`exported` integer DEFAULT false NOT NULL,
	`is_async` integer DEFAULT false NOT NULL,
	`is_test` integer DEFAULT false NOT NULL,
	`test_type` text,
	`doc_comment` text,
	`parse_status` text DEFAULT 'ok' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_code_nodes_repo` ON `code_nodes` (`repo_id`);--> statement-breakpoint
CREATE INDEX `idx_code_nodes_repo_file` ON `code_nodes` (`repo_id`,`file_path`);--> statement-breakpoint
CREATE INDEX `idx_code_nodes_repo_type` ON `code_nodes` (`repo_id`,`type`);--> statement-breakpoint
CREATE TABLE `file_cache` (
	`repo_id` text NOT NULL,
	`file_path` text NOT NULL,
	`file_hash` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`repo_id`, `file_path`),
	FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);

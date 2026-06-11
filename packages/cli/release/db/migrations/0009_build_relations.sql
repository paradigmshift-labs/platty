CREATE TABLE `code_relations` (
  `id` text PRIMARY KEY NOT NULL,
  `repo_id` text NOT NULL,
  `source_node_id` text NOT NULL,
  `kind` text NOT NULL,
  `target` text,
  `operation` text,
  `payload` text NOT NULL,
  `evidence_node_ids` text NOT NULL,
  `confidence` text NOT NULL,
  `unresolved_reason` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_code_relations_repo` ON `code_relations` (`repo_id`);
--> statement-breakpoint
CREATE INDEX `idx_code_relations_repo_kind` ON `code_relations` (`repo_id`,`kind`);
--> statement-breakpoint
CREATE INDEX `idx_code_relations_source` ON `code_relations` (`source_node_id`);

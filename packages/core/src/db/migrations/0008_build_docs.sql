CREATE TABLE `node_contracts` (
  `code_node_id` text PRIMARY KEY NOT NULL,
  `repo_id` text NOT NULL,
  `node_type` text NOT NULL,
  `io_contract` text,
  `code_slice_hash` text DEFAULT '' NOT NULL,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`repo_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_node_contracts_repo` ON `node_contracts` (`repo_id`);
--> statement-breakpoint
CREATE INDEX `idx_node_contracts_repo_type` ON `node_contracts` (`repo_id`,`node_type`);
--> statement-breakpoint
CREATE TABLE `documents` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `type` text NOT NULL,
  `track` text NOT NULL,
  `scope` text NOT NULL,
  `status` text NOT NULL,
  `content` text,
  `raw_llm_output` text DEFAULT '' NOT NULL,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_documents_project` ON `documents` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_documents_project_type` ON `documents` (`project_id`,`type`);
--> statement-breakpoint
CREATE TABLE `doc_deps` (
  `document_id` text NOT NULL,
  `code_node_id` text NOT NULL,
  `dep_type` text NOT NULL,
  PRIMARY KEY(`document_id`, `code_node_id`, `dep_type`),
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_doc_deps_code_node` ON `doc_deps` (`code_node_id`);

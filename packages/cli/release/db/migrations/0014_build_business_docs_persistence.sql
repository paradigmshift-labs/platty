ALTER TABLE `documents` ADD `updated_by` text DEFAULT 'system' NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_documents_canonical_unique` ON `documents` (`project_id`,`type`,`scope`,`scope_id`) WHERE `scope_id` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `document_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `document_id` text NOT NULL,
  `version_no` integer NOT NULL,
  `content` text NOT NULL,
  `summary` text,
  `created_by` text NOT NULL,
  `source_run_id` text,
  `source_commit` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_document_versions_doc_version` ON `document_versions` (`document_id`,`version_no`);
--> statement-breakpoint
CREATE INDEX `idx_document_versions_document` ON `document_versions` (`document_id`);
--> statement-breakpoint
CREATE TABLE `document_proposals` (
  `id` text PRIMARY KEY NOT NULL,
  `base_document_id` text,
  `project_id` text NOT NULL,
  `type` text NOT NULL,
  `scope` text NOT NULL,
  `scope_id` text NOT NULL,
  `operation` text NOT NULL,
  `proposed_content` text NOT NULL,
  `base_content_hash` text,
  `summary` text,
  `reason` text,
  `source_run_id` text,
  `source_commit` text,
  `status` text DEFAULT 'pending' NOT NULL,
  `validity` text DEFAULT 'fresh' NOT NULL,
  `created_by` text DEFAULT 'llm' NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `resolved_by` text,
  `resolved_at` text,
  FOREIGN KEY (`base_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_document_proposals_project` ON `document_proposals` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_document_proposals_base_document` ON `document_proposals` (`base_document_id`);
--> statement-breakpoint
CREATE INDEX `idx_document_proposals_target` ON `document_proposals` (`project_id`,`type`,`scope`,`scope_id`);
--> statement-breakpoint
CREATE INDEX `idx_document_proposals_status` ON `document_proposals` (`status`);

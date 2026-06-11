ALTER TABLE `documents` ADD `scope_id` text;
--> statement-breakpoint
ALTER TABLE `documents` ADD `validity` text DEFAULT 'fresh' NOT NULL;
--> statement-breakpoint
ALTER TABLE `documents` ADD `summary` text;
--> statement-breakpoint
CREATE INDEX `idx_documents_scope` ON `documents` (`project_id`,`scope`,`scope_id`);
--> statement-breakpoint
CREATE TABLE `document_links` (
  `from_document_id` text NOT NULL,
  `to_document_id` text NOT NULL,
  `link_type` text NOT NULL,
  `created_by` text DEFAULT 'system' NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  PRIMARY KEY(`from_document_id`, `to_document_id`, `link_type`),
  FOREIGN KEY (`from_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`to_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_document_links_from` ON `document_links` (`from_document_id`);
--> statement-breakpoint
CREATE INDEX `idx_document_links_to` ON `document_links` (`to_document_id`);
--> statement-breakpoint
CREATE TABLE `document_memories` (
  `document_id` text NOT NULL,
  `memory_key` text NOT NULL,
  `scope` text NOT NULL,
  `content` text NOT NULL,
  `source` text DEFAULT 'user' NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  PRIMARY KEY(`document_id`, `memory_key`),
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_document_memories_scope` ON `document_memories` (`scope`);

CREATE TABLE `doc_relation_links` (
  `document_id` text NOT NULL,
  `relation_id` text,
  `repo_id` text NOT NULL,
  `source_node_id` text NOT NULL,
  `kind` text NOT NULL,
  `target` text,
  `operation` text,
  `payload_json` text,
  `evidence_node_ids_json` text NOT NULL,
  `confidence` text NOT NULL,
  `unresolved_reason` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`relation_id`) REFERENCES `code_relations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_doc_relation_links_document` ON `doc_relation_links` (`document_id`);
--> statement-breakpoint
CREATE INDEX `idx_doc_relation_links_relation` ON `doc_relation_links` (`relation_id`);
--> statement-breakpoint
CREATE INDEX `idx_doc_relation_links_repo` ON `doc_relation_links` (`repo_id`);

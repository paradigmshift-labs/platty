CREATE TABLE `document_link_evidence` (
  `project_id` text NOT NULL,
  `from_document_id` text NOT NULL,
  `to_document_id` text NOT NULL,
  `link_type` text NOT NULL,
  `source_edge_id` text NOT NULL,
  `repo_id` text NOT NULL,
  `confidence` text NOT NULL,
  `source` text NOT NULL,
  `reason` text NOT NULL,
  `run_id` text,
  `created_by` text DEFAULT 'build_docs_materializer_v1' NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  PRIMARY KEY(`from_document_id`, `to_document_id`, `link_type`, `source_edge_id`),
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`from_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`to_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_document_link_evidence_project_type` ON `document_link_evidence` (`project_id`,`link_type`);
--> statement-breakpoint
CREATE INDEX `idx_document_link_evidence_source_edge` ON `document_link_evidence` (`source_edge_id`);
--> statement-breakpoint
CREATE INDEX `idx_document_link_evidence_to_doc_type` ON `document_link_evidence` (`to_document_id`,`link_type`);
--> statement-breakpoint
CREATE INDEX `idx_document_link_evidence_repo` ON `document_link_evidence` (`project_id`,`repo_id`);

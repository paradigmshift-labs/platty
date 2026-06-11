CREATE TABLE `document_item_model_links` (
  `project_id` text NOT NULL,
  `item_id` text NOT NULL,
  `model_id` text NOT NULL,
  `field_name` text,
  `link_type` text NOT NULL,
  `role` text NOT NULL,
  `evidence_json` text,
  `created_by` text DEFAULT 'business_graph_materializer_v1' NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`item_id`) REFERENCES `document_items`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`model_id`) REFERENCES `models`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_document_item_model_links_unique`
ON `document_item_model_links` (`item_id`, `model_id`, `field_name`, `link_type`);
--> statement-breakpoint
CREATE INDEX `idx_document_item_model_links_project`
ON `document_item_model_links` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_document_item_model_links_model`
ON `document_item_model_links` (`model_id`);

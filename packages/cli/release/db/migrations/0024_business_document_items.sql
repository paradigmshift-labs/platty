CREATE TABLE `document_items` (
  `id` text PRIMARY KEY NOT NULL,
  `document_id` text NOT NULL,
  `project_id` text NOT NULL,
  `item_type` text NOT NULL,
  `stable_key` text NOT NULL,
  `ordinal` integer NOT NULL,
  `title` text,
  `summary` text,
  `content` text NOT NULL,
  `content_hash` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `created_by` text DEFAULT 'system' NOT NULL,
  `updated_by` text DEFAULT 'system' NOT NULL,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_document_items_doc_type_stable` ON `document_items` (`document_id`,`item_type`,`stable_key`);
--> statement-breakpoint
CREATE INDEX `idx_document_items_document` ON `document_items` (`document_id`);
--> statement-breakpoint
CREATE INDEX `idx_document_items_project_type` ON `document_items` (`project_id`,`item_type`);
--> statement-breakpoint
CREATE INDEX `idx_document_items_stable_key` ON `document_items` (`project_id`,`item_type`,`stable_key`);
--> statement-breakpoint
CREATE TRIGGER `trg_document_items_project_match_insert`
BEFORE INSERT ON `document_items`
FOR EACH ROW
WHEN (SELECT `project_id` FROM `documents` WHERE `id` = NEW.`document_id`) IS NOT NEW.`project_id`
BEGIN
  SELECT RAISE(ABORT, 'document_items.project_id must match documents.project_id');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_document_items_project_match_update`
BEFORE UPDATE OF `document_id`, `project_id` ON `document_items`
FOR EACH ROW
WHEN (SELECT `project_id` FROM `documents` WHERE `id` = NEW.`document_id`) IS NOT NEW.`project_id`
BEGIN
  SELECT RAISE(ABORT, 'document_items.project_id must match documents.project_id');
END;
--> statement-breakpoint
CREATE TABLE `document_item_document_links` (
  `from_item_id` text NOT NULL,
  `to_document_id` text NOT NULL,
  `link_type` text NOT NULL,
  `role` text,
  `created_by` text DEFAULT 'system' NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  PRIMARY KEY(`from_item_id`, `to_document_id`, `link_type`),
  FOREIGN KEY (`from_item_id`) REFERENCES `document_items`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`to_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_document_item_document_links_from` ON `document_item_document_links` (`from_item_id`);
--> statement-breakpoint
CREATE INDEX `idx_document_item_document_links_to_doc` ON `document_item_document_links` (`to_document_id`);
--> statement-breakpoint
CREATE TABLE `document_item_item_links` (
  `from_item_id` text NOT NULL,
  `to_item_id` text NOT NULL,
  `link_type` text NOT NULL,
  `role` text,
  `created_by` text DEFAULT 'system' NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  PRIMARY KEY(`from_item_id`, `to_item_id`, `link_type`),
  FOREIGN KEY (`from_item_id`) REFERENCES `document_items`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`to_item_id`) REFERENCES `document_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_document_item_item_links_from` ON `document_item_item_links` (`from_item_id`);
--> statement-breakpoint
CREATE INDEX `idx_document_item_item_links_to_item` ON `document_item_item_links` (`to_item_id`);
--> statement-breakpoint
CREATE TABLE `document_item_relation_links` (
  `id` text PRIMARY KEY NOT NULL,
  `item_id` text NOT NULL,
  `relation_id` text,
  `relation_key` text NOT NULL,
  `repo_id` text NOT NULL,
  `source_node_id` text NOT NULL,
  `kind` text NOT NULL,
  `target` text,
  `operation` text,
  `canonical_target` text,
  `payload_json` text,
  `evidence_node_ids_json` text NOT NULL,
  `confidence` text NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`item_id`) REFERENCES `document_items`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`relation_id`) REFERENCES `code_relations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_document_item_relation_links_item_key` ON `document_item_relation_links` (`item_id`,`relation_key`);
--> statement-breakpoint
CREATE INDEX `idx_document_item_relation_links_item` ON `document_item_relation_links` (`item_id`);
--> statement-breakpoint
CREATE INDEX `idx_document_item_relation_links_relation` ON `document_item_relation_links` (`relation_id`);
--> statement-breakpoint
CREATE INDEX `idx_document_item_relation_links_canonical_target` ON `document_item_relation_links` (`repo_id`,`kind`,`canonical_target`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `document_items_fts` USING fts5(
  `item_id` UNINDEXED,
  `project_id` UNINDEXED,
  `item_type` UNINDEXED,
  `title`,
  `summary`,
  `content`
);
--> statement-breakpoint
CREATE TRIGGER `trg_document_items_fts_delete`
AFTER DELETE ON `document_items`
FOR EACH ROW
BEGIN
  DELETE FROM `document_items_fts` WHERE `item_id` = OLD.`id`;
END;

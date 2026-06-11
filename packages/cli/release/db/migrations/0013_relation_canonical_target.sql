ALTER TABLE `code_relations` ADD `canonical_target` text;
--> statement-breakpoint
CREATE INDEX `idx_code_relations_canonical_target` ON `code_relations` (`repo_id`,`kind`,`canonical_target`);
--> statement-breakpoint
ALTER TABLE `doc_relation_links` ADD `canonical_target` text;
--> statement-breakpoint
CREATE INDEX `idx_doc_relation_links_canonical_target` ON `doc_relation_links` (`repo_id`,`kind`,`canonical_target`);

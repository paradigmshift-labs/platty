ALTER TABLE `code_nodes` ADD `parent_node_id` text;
--> statement-breakpoint
ALTER TABLE `code_nodes` ADD `origin_kind` text;
--> statement-breakpoint
ALTER TABLE `code_nodes` ADD `role` text;
--> statement-breakpoint
CREATE INDEX `idx_code_nodes_parent` ON `code_nodes` (`parent_node_id`);
--> statement-breakpoint
CREATE INDEX `idx_code_nodes_origin` ON `code_nodes` (`repo_id`,`origin_kind`);
--> statement-breakpoint
CREATE INDEX `idx_code_nodes_role` ON `code_nodes` (`repo_id`,`role`);

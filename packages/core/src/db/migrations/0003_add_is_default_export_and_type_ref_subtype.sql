ALTER TABLE `code_edges` ADD `type_ref_subtype` text;--> statement-breakpoint
ALTER TABLE `code_nodes` ADD `is_default_export` integer DEFAULT false NOT NULL;
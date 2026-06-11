CREATE TABLE `project_llm_settings` (
  `project_id` text NOT NULL,
  `stage` text NOT NULL,
  `provider` text NOT NULL,
  `model` text NOT NULL,
  `api_version` text,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL,
  PRIMARY KEY (`project_id`, `stage`),
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);

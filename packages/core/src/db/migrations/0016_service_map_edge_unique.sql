DELETE FROM `service_map_edges`
WHERE rowid NOT IN (
  SELECT MIN(rowid)
  FROM `service_map_edges`
  GROUP BY
    `repo_id`,
    `source_type`,
    `source_id`,
    `target_type`,
    `target_id`,
    `kind`,
    `canonical_target`
);
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_service_map_edges_logical_uniq`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_service_map_edges_logical_uniq`
ON `service_map_edges` (
  `repo_id`,
  `source_type`,
  `source_id`,
  `target_type`,
  `target_id`,
  `kind`,
  `canonical_target`
);

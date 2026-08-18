CREATE VIRTUAL TABLE `jobs_fts` USING fts5(
	`title`,
	`description_fts`,
	content='jobs',
	content_rowid='id'
);
--> statement-breakpoint
INSERT INTO `jobs_fts` (`rowid`, `title`, `description_fts`)
SELECT `id`, `title`, COALESCE(`description_fts`, `description`)
FROM `jobs`;
--> statement-breakpoint
CREATE TRIGGER `jobs_fts_after_insert`
AFTER INSERT ON `jobs`
BEGIN
	INSERT INTO `jobs_fts` (`rowid`, `title`, `description_fts`)
	VALUES (NEW.`id`, NEW.`title`, COALESCE(NEW.`description_fts`, NEW.`description`));
END;
--> statement-breakpoint
CREATE TRIGGER `jobs_fts_after_delete`
AFTER DELETE ON `jobs`
BEGIN
	INSERT INTO `jobs_fts` (`jobs_fts`, `rowid`, `title`, `description_fts`)
	VALUES ('delete', OLD.`id`, OLD.`title`, COALESCE(OLD.`description_fts`, OLD.`description`));
END;
--> statement-breakpoint
CREATE TRIGGER `jobs_fts_after_update`
AFTER UPDATE OF `title`, `description`, `description_fts` ON `jobs`
BEGIN
	INSERT INTO `jobs_fts` (`jobs_fts`, `rowid`, `title`, `description_fts`)
	VALUES ('delete', OLD.`id`, OLD.`title`, COALESCE(OLD.`description_fts`, OLD.`description`));
	INSERT INTO `jobs_fts` (`rowid`, `title`, `description_fts`)
	VALUES (NEW.`id`, NEW.`title`, COALESCE(NEW.`description_fts`, NEW.`description`));
END;

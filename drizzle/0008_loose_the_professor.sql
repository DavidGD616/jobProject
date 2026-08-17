CREATE TABLE `extraction_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`domain` text NOT NULL,
	`dom_fingerprint` text NOT NULL,
	`selectors` text NOT NULL,
	`generated_at` integer NOT NULL,
	`generated_by` text,
	`last_ok_at` integer,
	`fail_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `extraction_rules_company_domain_uq` ON `extraction_rules` (`company_id`,`domain`);--> statement-breakpoint
CREATE INDEX `extraction_rules_fail_idx` ON `extraction_rules` (`fail_count`);
DROP INDEX `companies_ats_active_idx`;--> statement-breakpoint
DROP INDEX `companies_blocked_idx`;--> statement-breakpoint
CREATE INDEX `companies_ats_active_idx` ON `companies` (`ats_type`,`active`) WHERE active;--> statement-breakpoint
CREATE INDEX `companies_blocked_idx` ON `companies` (`blocked`) WHERE blocked;--> statement-breakpoint
DROP INDEX `jobs_company_posted_idx`;--> statement-breakpoint
DROP INDEX `jobs_closed_idx`;--> statement-breakpoint
CREATE INDEX `jobs_company_posted_idx` ON `jobs` (`company_id`,"posted_at" desc);--> statement-breakpoint
CREATE INDEX `jobs_closed_idx` ON `jobs` (`closed_at`) WHERE closed_at IS NULL;
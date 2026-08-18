CREATE TABLE `tailor_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`variant_id` integer,
	`error` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variant_id`) REFERENCES `resume_variants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tailor_requests_status_created_idx` ON `tailor_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `tailor_requests_job_created_idx` ON `tailor_requests` (`job_id`,`created_at`);
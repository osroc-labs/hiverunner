CREATE TABLE `job_exit` (
	`assignment_id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`machine_id` text NOT NULL,
	`exit_code` integer NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_job_exit_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_job_exit_machine_id_machine_id_fk` FOREIGN KEY (`machine_id`) REFERENCES `machine`(`id`)
);
--> statement-breakpoint
ALTER TABLE `job` ADD `assignment_id` text;--> statement-breakpoint
ALTER TABLE `job` ADD `end_reason` text;--> statement-breakpoint
ALTER TABLE `job` ADD `end_detail` text;--> statement-breakpoint
CREATE INDEX `job_assignment_idx` ON `job` (`assignment_id`);--> statement-breakpoint
CREATE INDEX `job_exit_org_idx` ON `job_exit` (`organization_id`,`created_at`);
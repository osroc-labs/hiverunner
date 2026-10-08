CREATE TABLE `billing_notice` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_billing_notice_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `spend_budget` (
	`organization_id` text PRIMARY KEY,
	`monthly_cents` integer NOT NULL,
	`at_limit` text DEFAULT 'warn' NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_spend_budget_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `billing_notice_org_idx` ON `billing_notice` (`organization_id`);
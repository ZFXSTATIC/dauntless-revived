CREATE TABLE `account_notices` (
    `account_id` text PRIMARY KEY NOT NULL,
    `message` text NOT NULL,
    `updated_at` integer NOT NULL,
    `actor` text NOT NULL
);

CREATE VIRTUAL TABLE `medicines_fts` USING fts5(`name`, `generic`, content=`medicines`, content_rowid=`rowid`);
--> statement-breakpoint
CREATE TRIGGER `medicines_fts_insert` AFTER INSERT ON `medicines` BEGIN
  INSERT INTO `medicines_fts` (`rowid`, `name`, `generic`) VALUES (new.`rowid`, new.`name`, new.`generic`);
END;
--> statement-breakpoint
CREATE TRIGGER `medicines_fts_delete` AFTER DELETE ON `medicines` BEGIN
  INSERT INTO `medicines_fts` (`medicines_fts`, `rowid`, `name`, `generic`) VALUES ('delete', old.`rowid`, old.`name`, old.`generic`);
END;
--> statement-breakpoint
CREATE TRIGGER `medicines_fts_update` AFTER UPDATE ON `medicines` BEGIN
  INSERT INTO `medicines_fts` (`medicines_fts`, `rowid`, `name`, `generic`) VALUES ('delete', old.`rowid`, old.`name`, old.`generic`);
  INSERT INTO `medicines_fts` (`rowid`, `name`, `generic`) VALUES (new.`rowid`, new.`name`, new.`generic`);
END;
--> statement-breakpoint
INSERT INTO `medicines_fts` (`medicines_fts`) VALUES ('rebuild');

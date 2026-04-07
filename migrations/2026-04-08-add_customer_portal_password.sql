ALTER TABLE customers ADD COLUMN password TEXT DEFAULT '123456';

UPDATE customers
SET password = '123456'
WHERE password IS NULL OR password = '';

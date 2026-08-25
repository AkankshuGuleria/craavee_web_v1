-- Seed data for development
INSERT OR IGNORE INTO users (id, email, role, credits) VALUES
  ('user-1', 'customer@craavee.app', 'customer', 640),
  ('user-2', 'runner@craavee.app', 'runner', 0),
  ('user-3', 'admin@craavee.app', 'admin', 0);

INSERT OR IGNORE INTO venues (id, name) VALUES
  ('venue-1', 'Craavee Lounge');

INSERT OR IGNORE INTO tables (id, venue_id, label, section) VALUES
  ('table-1', 'venue-1', 'Table B-2', 'Main Floor'),
  ('table-2', 'venue-1', 'Table A-14', 'Main Floor'),
  ('table-3', 'venue-1', 'VIP Lounge 1', 'VIP Section'),
  ('table-4', 'venue-1', 'Table C-4', 'Main Floor');

INSERT OR IGNORE INTO products (id, name, description, price, category, popular, out_of_stock) VALUES
  ('prod-1', 'Neon Citrus Spritz', 'Gin, blood orange liqueur, prosecco, and a touch of edible luminescence.', 120, 'Cocktails', 1, 0),
  ('prod-2', 'Truffle Parmesan Fries', 'Crispy shoestring fries tossed in white truffle oil and aged parmesan.', 85, 'Snacks', 0, 0),
  ('prod-3', 'Wagyu Sliders (3pcs)', 'Miniature wagyu patties, caramelized onions, gruyere, on brioche.', 210, 'Main', 0, 1),
  ('prod-4', 'Glacial Artisan Water', '750ml still water sourced from untouched glaciers.', 40, 'Essentials', 0, 0),
  ('prod-5', 'Signature Old Fashioned', 'Bourbon, sugar, bitters, orange peel.', 140, 'Cocktails', 1, 0);

INSERT OR IGNORE INTO orders (id, user_id, total_credits, status, location) VALUES
  ('1084', 'user-1', 240, 'packed', 'Table B-2'),
  ('1081', 'user-2', 85, 'placed', 'Table A-14'),
  ('1078', 'user-3', 360, 'packed', 'VIP Lounge 1'),
  ('1075', 'user-4', 80, 'packed', 'Table C-4');

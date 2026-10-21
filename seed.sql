INSERT INTO menu_items (name, description, category, price_paise) VALUES
('Classic Cold Coffee', 'Chilled coffee blended until smooth.', 'Coffee', 12900),
('Iced Americano', 'Espresso over ice and water.', 'Coffee', 9900),
('Badam Shake', 'Creamy almond milkshake.', 'Shakes', 14900),
('Chocolate Mastani', 'Rich chocolate dessert shake.', 'Mastani', 17900),
('Vanilla Ice Cream', 'Classic scoop of vanilla ice cream.', 'Ice Cream', 7900),
('French Fries', 'Crispy salted fries.', 'Snacks', 9900)
ON CONFLICT (name, category) DO NOTHING;

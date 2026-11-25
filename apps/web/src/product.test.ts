import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productPrice, productPlaceholder } from './product.ts';

test('цена товара: с весом, без веса, без цены', () => {
  assert.equal(productPrice({ price: '55k', unit: '100 г' }), '55k · 100 г');
  assert.equal(productPrice({ price: '250 000 ₫/кг', unit: null }), '250 000 ₫/кг');
  assert.equal(productPrice({ price: null, unit: '6 шт' }), 'цена по запросу · 6 шт');
});

test('товар без фото: заглушка по категории', () => {
  assert.notEqual(productPlaceholder('food'), productPlaceholder('handmade'));
});

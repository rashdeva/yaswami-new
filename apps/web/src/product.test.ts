import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PRODUCT_CATEGORIES } from '@yaswami/core';
import { productCategoryName, productChips, productPrice, productPlaceholder } from './product.ts';

test('цена товара: с весом, без веса, без цены', () => {
  assert.equal(productPrice({ price: '55k', unit: '100 г' }), '55k · 100 г');
  assert.equal(productPrice({ price: '250 000 ₫/кг', unit: null }), '250 000 ₫/кг');
  assert.equal(productPrice({ price: null, unit: '6 шт' }), 'цена по запросу · 6 шт');
});

test('товар без фото: у каждой категории своя заглушка и подпись', () => {
  const slugs = PRODUCT_CATEGORIES.map((c) => c.slug);
  assert.equal(new Set(slugs.map(productPlaceholder)).size, slugs.length);
  assert.equal(productCategoryName('dairy'), 'Молочное и сыр');
});

test('плашки категорий: только когда есть из чего выбрать', () => {
  assert.deepEqual(productChips(['bakery', 'dairy']), ['bakery', 'dairy']);
  assert.deepEqual(productChips(['bakery']), [], 'одна категория — плашки ничего не отбирают');
  assert.deepEqual(productChips([]), []);
});

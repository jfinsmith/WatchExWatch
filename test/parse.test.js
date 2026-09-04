import test from 'node:test';
import assert from 'node:assert/strict';
import {
  derivePrice, extractTags, detectBrands, parseFlairRange, fmtRange,
  priceFromComment, originalFromPreview, isProxyableHost, BRANDS, detectSold,
} from '../lib/parse.js';

test('price: title wins over body', () => {
  const p = derivePrice('[WTS] Speedmaster - $5,900 shipped', 'Bought at $6,200 in 2019.');
  assert.equal(p.value, 5900);
  assert.equal(p.source, 'title');
  assert.equal(p.shipped, true);
});

test('price: falls back to the body', () => {
  const p = derivePrice('[WTS] Seiko SKX007', 'Asking 210 shipped CONUS.');
  assert.equal(p.value, 210);
  assert.equal(p.source, 'body');
});

test('price: understands k, commas, USD and OBO', () => {
  assert.equal(derivePrice('[WTS] Sub — asking 12.5k obo', '').value, 12500);
  assert.equal(derivePrice('[WTS] Sub — asking 12.5k obo', '').obo, true);
  assert.equal(derivePrice('[WTS] BB58 $3,450', '').value, 3450);
  assert.equal(derivePrice('[WTS] Oris 1200 USD', '').value, 1200);
});

test('price: ignores reference and model numbers', () => {
  assert.equal(derivePrice('[WTS] Omega Speedmaster 3861', '').value, null);
  assert.equal(derivePrice('[WTS] Rolex', 'Ref 116610LN, cal 3135, 40mm').value, null);
  assert.equal(derivePrice('[WTS] Omega', 'Ref 310.30.42.50.04.001 full set').value, null);
});

test('price: multiple prices are reported as candidates', () => {
  const p = derivePrice('[WTS] Three watches', 'Seiko $300, Oris $900, Tudor $2,400');
  assert.equal(p.multiple, true);
  assert.deepEqual(p.candidates, [300, 900, 2400]);
});

test('price: seller comments are tagged as such', () => {
  const p = priceFromComment('Timestamp above. Price: $7,000 net to me CONUS.');
  assert.equal(p.value, 7000);
  assert.equal(p.source, 'comment');
  assert.equal(priceFromComment('PM sent, interested!'), null);
});

test('tags: extracted from title and flair', () => {
  assert.deepEqual(extractTags('[WTS][WTT] Rolex', ''), ['WTS', 'WTT']);
  assert.ok(extractTags('[WTS] Rolex', 'Sold').includes('SOLD'));
  assert.deepEqual(extractTags('No tags here', ''), []);
});

test('brands: matched by name and by model alias', () => {
  assert.deepEqual(detectBrands('[WTS] Tudor Black Bay 58 + Speedy', ''), ['Tudor', 'Omega']);
  assert.deepEqual(detectBrands('[WTS] Snowflake SBGA211', ''), ['Grand Seiko']);
  assert.deepEqual(detectBrands('[WTS] a plain strap', ''), []);
});

test('brands: the list has no duplicates', () => {
  const names = BRANDS.map((b) => b.name);
  assert.equal(names.length, new Set(names).size);
});

test('flair: every bracket format the subreddit uses', () => {
  assert.deepEqual(parseFlairRange('$1000-$2500'), { min: 1000, max: 2500 });
  assert.deepEqual(parseFlairRange('Under $500'), { min: 0, max: 500 });
  assert.deepEqual(parseFlairRange('$10k+'), { min: 10000, max: null });
  assert.deepEqual(parseFlairRange('1-5k'), { min: 1000, max: 5000 });
  assert.deepEqual(parseFlairRange('500 to 1000'), { min: 500, max: 1000 });
  assert.equal(parseFlairRange('WTS'), null);
  assert.equal(parseFlairRange(''), null);
});

test('flair: formatted for display', () => {
  assert.equal(fmtRange({ min: 1000, max: 2500 }), '$1,000–$2,500');
  assert.equal(fmtRange({ min: 0, max: 500 }), 'under $500');
  assert.equal(fmtRange({ min: 10000, max: null }), '$10,000+');
});

test('images: preview URLs map to unsigned originals', () => {
  assert.equal(
    originalFromPreview('https://preview.redd.it/abc123.jpg?width=140&height=140&s=deadbeef'),
    'https://i.redd.it/abc123.jpg',
  );
  // external-preview hosts previews of off-site images; those ids do not exist on i.redd.it
  assert.equal(originalFromPreview('https://external-preview.redd.it/xyz.jpeg?width=640'), null);
  assert.equal(originalFromPreview('https://i.redd.it/abc123.jpg'), null);
});

test('proxy: only reddit and imgur hosts are fetchable', () => {
  assert.ok(isProxyableHost('https://i.redd.it/a.jpg'));
  assert.ok(isProxyableHost('https://preview.redd.it/a.jpg?x=1'));
  assert.ok(isProxyableHost('https://i.imgur.com/a.jpg'));
  assert.equal(isProxyableHost('https://evil.example.com/a.jpg'), false);
  assert.equal(isProxyableHost('http://localhost:5173/secret'), false);
  assert.equal(isProxyableHost('not a url'), false);
});

test('sold: flair, title, and seller comment', () => {
  assert.equal(detectSold({ flair: 'Sold' }), true);
  assert.equal(detectSold({ flair: '$1000-$2500' }), false);
  assert.equal(detectSold({ title: '[WTS] Rolex — SOLD pending payment' }), true);
  assert.equal(detectSold({ comment: 'Sale pending, first in line has it' }), true);
  assert.equal(detectSold({ comment: 'PM sent!' }), false);
});

test('sold: negations do not retire a live post', () => {
  assert.equal(detectSold({ title: 'Never sold outside of AD' }), false);
  assert.equal(detectSold({ comment: 'This will be sold to the first offer' }), false);
  assert.equal(detectSold({ title: '[WTS] Unsold from last week, relisting' }), false);
});

test('price: dollar sign can trail the number', () => {
  assert.equal(derivePrice('[WTS] Invicta Grand Diver 200$ OBO', '').value, 200);
  assert.equal(derivePrice('[WTS] Seiko 1,250$ shipped', '').value, 1250);
  assert.equal(derivePrice('[WTS] Tudor 3.5k$', '').value, 3500);
});

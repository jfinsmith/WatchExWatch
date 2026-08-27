import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAtom, parseCommentAtom, imagesFromContent, RedditClient } from '../lib/reddit.js';

// Shaped like a real reddit Atom entry: HTML nested inside XML, so entities are double-escaped.
const FEED = `<feed>
<entry>
  <title>[WTS] Omega Speedmaster 3861 Full Set</title>
  <link href="https://www.reddit.com/r/Watchexchange/comments/abc123/wts_omega/"/>
  <published>2026-08-25T18:00:00+00:00</published>
  <author><name>/u/seller99</name></author>
  <content type="html">&lt;div&gt;&lt;a href="https://i.redd.it/pic1.jpeg"&gt;&lt;img src="https://preview.redd.it/pic1.jpeg?width=640&amp;amp;s=aaa"&gt;&lt;/a&gt;&lt;p&gt;Asking &amp;#36;5,900 shipped.&lt;/p&gt;&lt;/div&gt; &amp;#32; submitted by &amp;#32; /u/seller99 [link] [comments]</content>
  <media:thumbnail url="https://preview.redd.it/pic1.jpeg?width=140&amp;height=140&amp;s=bbb"/>
</entry>
<entry>
  <title>[WTS] Gallery post</title>
  <link href="https://www.reddit.com/r/Watchexchange/comments/def456/wts_gallery/"/>
  <published>2026-08-25T17:00:00+00:00</published>
  <author><name>/u/seller42</name></author>
  <content type="html">&lt;a href="https://www.reddit.com/gallery/def456"&gt;gallery&lt;/a&gt;</content>
  <media:thumbnail url="https://preview.redd.it/pic2.jpg?width=140&amp;height=140&amp;s=ccc"/>
</entry>
</feed>`;

test('atom: posts are normalized', () => {
  const [a, b] = parseAtom(FEED, 'Watchexchange');
  assert.equal(a.id, 'abc123');
  assert.equal(a.author, 'seller99');
  assert.equal(a.title, '[WTS] Omega Speedmaster 3861 Full Set');
  assert.deepEqual(a.tags, ['WTS']);
  assert.deepEqual(a.brands, ['Omega']);
  assert.equal(a.price.value, 5900);
  assert.equal(b.id, 'def456');
});

test('atom: reddit’s footer is stripped and entities decoded', () => {
  const [a] = parseAtom(FEED, 'Watchexchange');
  assert.equal(a.bodyPreview, 'Asking $5,900 shipped.');
  assert.ok(!a.bodyPreview.includes('&#'));
  assert.ok(!a.bodyPreview.includes('submitted by'));
});

test('atom: single-image posts get the original plus a sized thumbnail', () => {
  const [a] = parseAtom(FEED, 'Watchexchange');
  assert.equal(a.images[0].url, 'https://i.redd.it/pic1.jpeg');
  assert.match(a.images[0].thumb, /width=640/);
  assert.equal(a.images[0].tiny, undefined);
});

test('atom: gallery posts fall back to the original with a 140px placeholder', () => {
  const [, b] = parseAtom(FEED, 'Watchexchange');
  assert.equal(b.images[0].url, 'https://i.redd.it/pic2.jpg');
  assert.equal(b.images[0].thumb, 'https://i.redd.it/pic2.jpg');
  assert.match(b.images[0].tiny, /width=140/);
});

test('images: the best copy of each media id wins', () => {
  const html = ['https://preview.redd.it/x.jpg?width=140&s=a',
                'https://preview.redd.it/x.jpg?width=640&s=b',
                'https://i.redd.it/x.jpg'].join(' ');
  const imgs = imagesFromContent(html, null);
  assert.equal(imgs.length, 1, 'one media id, one image');
  assert.equal(imgs[0].url, 'https://i.redd.it/x.jpg');
  assert.match(imgs[0].thumb, /width=640/);
});

test('comments: authors and bodies come through', () => {
  const xml = `<feed><entry>
    <id>t1_c1</id>
    <author><name>/u/seller99</name></author>
    <published>2026-08-25T18:05:00+00:00</published>
    <link href="https://www.reddit.com/r/Watchexchange/comments/abc123/_/c1/"/>
    <content type="html">&lt;p&gt;Price: &amp;#36;7,000 net to me.&lt;/p&gt;</content>
  </entry></feed>`;
  const [c] = parseCommentAtom(xml);
  assert.equal(c.author, 'seller99');
  assert.equal(c.body, 'Price: $7,000 net to me.');
  assert.equal(c.permalink, 'https://www.reddit.com/r/Watchexchange/comments/abc123/_/c1/');
});

test('rate limiting: an exhausted window gates the next request', () => {
  const c = new RedditClient({ clientId: '', userAgent: 'test' });
  const headers = (rem, reset) => ({ headers: { get: (k) => ({ 'x-ratelimit-remaining': rem, 'x-ratelimit-reset': reset }[k]) } });
  assert.equal(c.nextAllowedIn(), 0, 'no data yet: go ahead');
  c.noteRateHeaders(headers('0.0', '50'));
  assert.ok(c.nextAllowedIn() > 48_000, 'must wait out the window');
  c.rate.at -= 51_000;
  assert.equal(c.nextAllowedIn(), 0, 'window elapsed');
  c.noteRateHeaders(headers('97.0', '480'));
  assert.equal(c.nextAllowedIn(), 0, 'budget remaining');
});

test('rate limiting: authenticated clients are not gated by the public budget', () => {
  const c = new RedditClient({ clientId: 'id', clientSecret: 'secret', userAgent: 'test' });
  assert.equal(c.mode, 'api');
  c.noteRateHeaders({ headers: { get: () => '0.0' } });
  assert.equal(c.nextAllowedIn(), 0);
});

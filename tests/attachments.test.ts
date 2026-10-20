import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveAssetUrl } from '../src/lib/attachments';

test('a fragment or query stays after the asset path', () => {
	assert.equal(resolveAssetUrl('../docs/paper.pdf#page=2', 'Uni/Notes'), '/api/assets/Uni/docs/paper.pdf#page=2');
	assert.equal(resolveAssetUrl('img.png?v=1', null), '/api/assets/img.png?v=1');
});

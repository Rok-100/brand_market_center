import test from 'node:test';
import assert from 'node:assert/strict';
import { integratedLaunchTarget } from './integrated-routes.mjs';

test('only configured same-origin hub paths are launchable', () => {
  const key = 'creative-hub';
  const root = '/yxb/wis-marketing-hub/';
  assert.equal(integratedLaunchTarget(key, JSON.stringify({[key]: `${root}modules/creative-hub/`})), `${root}modules/creative-hub/`);
  for (const value of ['https://old.example.test/', '//old.example.test', '/yxb/other/', `${root}../admin`, `${root}%2e%2e/admin`, `${root}modules/a?next=old`]) {
    assert.equal(integratedLaunchTarget(key, JSON.stringify({[key]: value})), '', value);
  }
});
